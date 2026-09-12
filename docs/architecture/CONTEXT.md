# Package architecture

Defines how packages in this monorepo may depend on each other: the four tiers, what belongs in each, and the vocabulary for diagnosing an illegal edge. The four tiers are four real directories, so placement is visible in the file tree and in every diff.

## The four tiers

| #   | Tier            | Directory      | Contains                                                            | Membership test                                          |
| --- | --------------- | -------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | **Packages**    | `packages/`    | mechanism, shapes, infrastructure clients, cross-boundary contracts | Knows about no concept, or only the _shape_ of one       |
| 2   | **Domains**     | `domains/`     | `workspaces`, `accounts`, `tasks`, `executions`                        | Owns one concept end to end                              |
| 3   | **Entrypoints** | `entrypoints/` | `control`, `operator`                                               | Assembles domains into a transport, protocol, or surface |
| 4   | **Apps**        | `apps/`        | `api`, `devbox`                                                      | Deployables and runtimes. Not imported by other packages |

Workspace package names are `@bridle/<dir>` regardless of tier; the tier is the directory. Directory names must therefore be unique across workspace packages: use `apps/api` and `entrypoints/control`, not two packages both named `control`.

Bridle's proposed package layout and ownership are in [the codebase plan](../plans/codebase.md). Those packages are proposed, not all implemented. The rules here apply as they are introduced.

## The two rules

**1. Depend downward, or sideways.** A package may import any package in a lower tier and any package in its own tier. It may never import a higher tier.

**2. No cycles, ever.** Within a tier, dependencies form a DAG. `A -> B` declares B the lower-level concept; `A <-> B` is banned at any length.

Rule 2 is the hard failure. Rule 1 is the scoreboard.

## Language

**Tier**: one of the four ranks above. _Avoid_: layer, level.

**Domain**: a tier-2 package owning one concept end to end — deep knowledge of one thing. Domains may depend on each other in one direction only.

**Horizontal**: a package spanning every concept — shallow knowledge of everything. Legal only as a **substrate horizontal** (tier 1: mechanism or shapes, no concept behaviour) or an **assembly horizontal** (tier 3–4: composes domains into a transport or runtime). A **middle horizontal** — depended on by domains _and_ depending on them — cycles by construction and is forbidden.

**Sink**: imports nothing, imported by many (bottom of the graph). **Root**: imports many, imported by nothing (apps). "Leaf" is ambiguous between the two; say which.

**Closure**: the transitive set of files an import pulls in and the highest tier it reaches. The true cost of a module, as opposed to its direct imports. Never judge a module's tier by its direct imports.

**Leaf submodule**: a lower-tier module living inside a higher-tier package, importable from below because its closure provably stays below the importer — e.g. `@bridle/x/y`. The rule that keeps it true: **a contract module must not import its own domain's implementation.** The moment it imports a service or handler, every importer inherits the whole domain.

**Upward edge**: an import from a lower tier to a higher one. **Same-tier cycle**: a loop inside one tier — the hard failure.

## Relationships

- **Entrypoint → domain**: entrypoints import every domain they assemble. No domain imports an entrypoint. A domain that seems to need one is missing something in tier 1.
- **Domain implementation → provider package**: domains own provider-neutral services and their implementation Layers. A provider-specific domain Layer translates to a tier-1 provider client. The provider package never imports or implements the domain service.
- **App → domain / entrypoint**: runtimes select domain Layers and supply secrets, bindings, and platform resources. Provider communication belongs in packages; domain-to-provider translation belongs in domains, not apps. Domains never import a runtime.
- **Domain → domain**: one direction only. A mutual pair is resolved by merging, extracting downward, inverting through a contract, or relocating a misfiled file — never by copying code.
- **Shared values needed below their owner → tier 1**: extract genuinely shared IDs/value shapes when keeping them in one owner would create an upward edge or cycle. A domain type being consumed by an entrypoint is already a legal downward import. Keep domain capability interfaces, inputs/results, and errors with their owner; crossing a boundary alone does not justify moving them into Contracts.
- **Entrypoint-neutral services**: domain services speak Effect (`Stream`, `Effect`, typed errors). Protocol shapes (SSE, AG-UI, RPC envelopes) are adapted in tier 3, never inside a domain.

## Bridle-specific placement

- **Tasks** owns authoritative task records, questions, approvals, findings, and handoff facts. The Cloudflare task DO hosts this behavior; it does not own a second implementation of it.
- **Executions** owns attempt assignments and specialist-session/invocation lifecycle. Its control-side and devbox-side modules share one authoritative record, not two independently writable copies of task state.
- **Accounts** owns user identity links and cached provider connections. **Workspaces** owns team membership, repository access, and process configuration. Entrypoints combine those checks.
- **Operator** is an entrypoint. It assembles domain capabilities into an AI tool interface; it is not a tier-2 service that every domain depends on.
- **Slack** communication and signature/protocol handling live in `packages/slack`, using `@distilled.cloud/slack`. The task domain owns the neutral conversation capability and its Slack implementation Layer. Control mounts HTTP routes and assembles use cases; it does not call the Slack SDK.
- **Namespace, Herdr, and Plannotator** communication lives in their provider packages. The executions domain owns neutral devbox, session, and plan-review services plus the default provider implementation Layers. Keep runtime-specific implementations behind focused subpaths.
- **Contracts** holds only genuinely shared values. Domain-owned schemas stay with their owner; moving all types into a global package would erase ownership rather than improve it.

### Provider-neutral domain services

This separation is required, not an optional wrapper pattern:

```text
consumer/app → domain service module
                 ├─ domain contract
                 └─ domain implementation Layer → provider package → SDK/API/CLI
                              └─ domain contract
```

The happy path is one focused service import, not a package-root barrel or a separate Layer import:

```ts
import { Devbox } from "@bridle/executions/devbox"

Devbox.Service
Devbox.layer
Devbox.layerNoDeps
```

The canonical namespace exposes the neutral service and its composed default Layer together. The Namespace implementation imports `@bridle/namespace` internally. Apps normally select `Devbox.layer`; an explicit provider subpath is only needed to choose a non-default implementation.

Provider packages may expose provider terminology and provider errors. They do not own the public devbox/session/review abstraction, import domain tags, or translate Bridle policy. Domain implementations translate requests, identifiers, lifecycle observations, and errors. Domain contracts must not leak provider SDK types, vendor configuration fields, or vendor-specific service requirements.

Distinguish a provider-neutral API from an SDK-free import. The public service module intentionally exposes its defaults and may load their provider dependencies. Where separate provider modules need the service tag, put that tag/interface in an internal `contract.ts`. Implementations import that contract directly, never the public module that re-exports them. The public module re-exports the same tag, not a second service definition.

A contract-only subpath may be exposed when cross-runtime consumers genuinely need it. It must not import the implementation, but it is an exception for isolation rather than the normal import path. Replacement changes the implementation Layer and its configuration, not consumer imports or business logic. Persistent provider associations remain private to the implementation and still need migration/reconciliation when a provider changes.

Neutrality does not require one domain package per service or a universal provider plugin framework. Start with focused capability modules in the owning domain. Pure shared values can stay in tier 1; product capability interfaces belong to domains.

### Default Layers and test composition

The normal import/provide path must be small. Services with a sensible default export a composed `layer`, not just an implementation that leaves every transitive dependency to the app.

- `layer` supplies the chosen implementation and its ordinary default dependencies recursively.
- `layerNoDeps` is that implementation with dependencies left unprovided, for explicit composition and dependency substitution. The name means no dependencies are bundled, not that its Effect environment is empty.
- `layerTest` is optional. Add a reusable test composition when needed, not an automatic fake for every service.

These export conventions match the pinned Effect v4 [composition example](../../repos/effect/ai-docs/src/01_effect/03_services/20_layer-composition.ts) and [service-testing example](../../repos/effect/ai-docs/src/09_testing/20_layer-tests.ts). They are values built with normal Layer APIs, not a new dependency-injection framework.

The relationship is schematically:

```ts
export const layer = layerNoDeps.pipe(
  Layer.provide(DefaultDependencies),
)
```

A self-contained default ideally has `Layer.Layer<Service, StartupError, never>`. Where necessary, leave a small, meaningful runtime requirement such as a storage binding, scoped credential grant, or host process services. Configuration may instead be read through Effect Config and fail with a typed startup error. Do not invent credentials, access grants, production storage, or a billing fallback merely to make the requirement type `never`.

Apply this recursively. A higher-level service's default uses its dependencies' default Layers. Domain defaults remain within the domain's legal dependency graph; cross-domain application defaults belong to entrypoints. Apps close the remaining host/configuration requirements once. App entry methods and service methods do not rebuild the whole dependency graph or call `Effect.provide(DefaultLayer)` on every invocation.

Expose `Service`, `layer`, and `layerNoDeps` through the same canonical namespace at the focused service path. Do not require an additional `/layer` import for normal use or an implementation-specific import just to substitute dependencies. `layerNoDeps` does not guarantee an SDK-free import; use a contract-only export when a test or remote adapter genuinely requires import isolation.

To test the real service with substituted dependencies, compose `layerNoDeps` with the required test Layers using `Layer.provide`. To replace the whole service, supply a Layer for the same neutral service tag. Do not merge a test dependency alongside a fully composed production `layer` and expect it to replace dependencies already provided inside that Layer. Recompose at the boundary being replaced, including higher-level `layerNoDeps` values when necessary. A reusable `layerTest` can capture that composition.

Use `Layer.provide` to keep internal dependencies private. Use `provideMerge` only when consumers intentionally need those services too. Share stable Layer values within one build graph so Effect can memoize the same instance; a newly constructed Layer or a separate runtime is not automatically shared. Different user/task configuration must have deliberate isolation rather than sharing an accidentally captured credential context.

Build and scope the top-level graph once per appropriate runtime lifetime. Effect-native runtimes provide it around the main program; imperative hosts can reuse a `ManagedRuntime` and dispose it when its owning lifetime ends. Neither service methods nor default Layers create private global runtimes. Long-running resources belong to scopes, and importing a Layer module does not initiate provider work.

A host-specific default must not erase an authority boundary. The devbox's task capability is remote; closing its requirements must never bundle the authoritative Cloudflare task store or credential owner into that process. Select the correct host composition once, rather than asking every caller to choose again.

### Deployment root

The root `alchemy.run.ts` is the final deployment composition root. It may import resource declarations from `apps/`. This is the sole exception to apps being imported by nobody, and it creates no permission for upward package imports or app-to-app dependencies.

No application package imports `alchemy.run.ts`, including for inferred binding types. Those types stay app-local. `repos/` is reference material outside the tier graph. `scripts/` is development tooling, not an application dependency.

### Runtime import closure

Tier legality does not prove runtime compatibility. A public service module exposing default Layers is not automatically Worker-safe, even when its method signatures are provider-neutral. Check the actual import closure; do not rely on unused exports being tree-shaken or dynamic imports making Node dependencies universally compatible. Use a compatible host default or a narrowly exposed contract-only export where necessary. Contract-only exports must not re-export implementations.

A remote domain client uses the isolated contract when needed and provides the same domain capability without importing its authoritative implementation. It does not run a second domain service over a remote storage port.

Prefer ordinary downward imports over leaf-submodule exceptions in the initial design. New exceptions require an explicit import-closure check, not a claim that a filename looks like a contract.

## Where new code goes

1. **Does it know about a concept?** No — tier 1. Yes — continue.
2. **Does it know about more than one concept?** Yes — it is horizontal; it belongs in tier 3/4 unless it is pure mechanism, in which case strip the concept knowledge and it becomes tier 1. Never in between.
3. **Is it a genuinely shared value or a domain-owned contract/behavior?** Shared values needed across independent owners can live in tier 1. Domain service interfaces, their types/errors, and implementation Layers live in tier 2. Provider protocol communication lives in tier 1; the domain implementation translates between the two.

If step 3 leaves you unsure which domain owns it, that is a finding: the concept has no owning package yet. Note it rather than filing the code next to something that looks similar.

## Enforcement

Not yet automated. A `scripts/dep-map.ts` (tier assignment, SCC detection, `closure <specifier>` report) is planned; until then every leaf-submodule claim is checked by reading the module's imports.
