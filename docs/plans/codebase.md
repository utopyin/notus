# Bridle monorepo design

Status: proposal for review. This document applies the [four-tier rules](../architecture/CONTEXT.md) to the [agreed product](../../CONTEXT.md). It does not scaffold packages or finalize the infrastructure topology.

## 1. Decisions and assumptions

Already chosen:

- Bun workspaces and Turborepo, with `packages/`, `domains/`, `entrypoints/`, and `apps/`.
- Effect v4; Alchemy v2 and a root `alchemy.run.ts` for infrastructure deployment.
- Provider communication lives in tier-1 packages. Provider-neutral services and their default provider implementation Layers live in domains. Apps select/configure those Layers; callers do not depend on the provider.
- One focused service import exposes the canonical namespace with `Service`, `layer`, and `layerNoDeps`. No separate `/layer` import is required for the happy path. The default `layer` bundles sensible dependencies recursively; `layerNoDeps` leaves them injectable. Apps provide top-level Layers and real runtime requirements, not a hand-built dependency tree at every call site.
- Slack first, using `@distilled.cloud/slack` for outbound Web API calls.
- An AI operator owns workflow decisions. Code provides tools, execution limits, persistence, authorization, and waiting.
- Namespace hosts task dev boxes. Herdr manages specialist-agent terminals. Plannotator handles the plan review UI.
- One task Durable Object records authoritative task progress and routes external input/output.
- User-owned provider connections are cached across tasks; token refresh must not require routine login.
- Humans approve plans and perform final code review and merge. Bridle never merges.

Proposed defaults, not newly agreed requirements:

- Two initial deployable runtimes: the Cloudflare API/control service and the dev-box process.
- Four domains, with no domain-to-domain imports initially. Application entrypoints coordinate them.
- One assigned execution attempt at a time per task, with multiple specialist sessions inside it.
- One checked-out repository per initial execution. Types leave room for repository sets, but multi-repository execution is not implemented speculatively.
- Preserve the dev box while work and live plan approval need its processes. Retention after handoff remains open.

The cached-user-login direction does not depend on adopting Codex as the operator. The Erudane-style Effect provider remains the first direct model integration to validate.

## 2. Proposed tree

These are planned packages, not directories that must all be created before the first working task.

```text
alchemy.run.ts                 deployment composition root

packages/                      tier 1: provider communication and shared values
  contracts/                   shared identities, conversation/artifact values
  namespace/                   Namespace API/SDK operations
  herdr/                       Herdr protocol and terminal operations
  plannotator/                 Plannotator CLI/backend communication
  slack/                       Slack verification/protocol and Distilled client
  openai/                      OpenAI login/refresh and model communication
  github/                      GitHub installation/token/repository operations
  cloudflare/                  Cloudflare storage/binding access

domains/                       tier 2: product ownership
  workspaces/                  team access, repositories, configuration
  accounts/                    people, external identities, provider connections
  tasks/                       task record, conversations, approvals, artifacts
  executions/                  attempts, neutral devbox/session/review services

entrypoints/                   tier 3: application assembly
  control/                     HTTP/WS APIs, source ingress, login/review routes
  operator/                    model loop, tool assembly, default role prompts

apps/                          tier 4: concrete runtimes and bindings
  api/                         Alchemy Worker/DO declarations and cloud Layers
  devbox/                      supervisor, operator process, local/remote Layers

docs/
  architecture/CONTEXT.md       tier rules and vocabulary
  plans/codebase.md             this proposal
  research/                    evidence and compatibility gaps

repos/                         read-only upstream references, outside all tiers
scripts/                       repository tooling and temporary local bootstrap
```

Each package uses the unique name `@bridle/<directory>`. In particular, the runtime is `@bridle/api`, not a second `@bridle/control` conflicting with the entrypoint package.

Do not add `core`, `common`, `shared`, a global service registry, or a generic workflow engine. Do not add a frontend package merely to host Plannotator's existing UI. Login and small status pages can initially be served by the control entrypoint.

A separate `apps/provisioner` remains conditional on the Namespace Worker-compatibility spike. Its absence must not be disguised by pretending the Node SDK runs unchanged in Workers.

## 3. Tier 1: provider communication without product policy

### `@bridle/contracts`

A small home for values genuinely shared between independent owners: user/workspace/task/execution identifiers, external actor references, conversation addresses, source-neutral messages, and artifact references/digests.

Use focused subpaths such as `/ids`, `/conversation`, and `/artifacts`. Task commands, findings, approval rules, account records, execution state, and public capability services stay in their domains. A transport schema assembled only in tier 3 stays there too. Shared values are not a reason to move domain interfaces into this package.

No domain implementation, SDK, database, or application import is allowed here. Prefer runtime Schemas for values crossing trust boundaries, not duplicated unchecked interfaces.

### Provider packages

Each provider package owns communication with that provider, including SDK/HTTP/CLI calls, wire decoding, protocol authentication, and provider-specific failures. Its API may speak the provider's language. It does not define Bridle's neutral service or import its domain tag.

| Package | Communication it owns | What stays above it |
| --- | --- | --- |
| `@bridle/namespace` | Instance operations, activation observations, connectivity, Namespace keepalive mechanics | Neutral devbox lifecycle, assignment policy, Bridle devbox IDs |
| `@bridle/herdr` | Terminal commands, pane/tab IDs, launch/readiness observations, event waits, cancellation | Neutral session interface, specialist roles, invocation/result meaning |
| `@bridle/plannotator` | CLI supervision, ready port, backend protocol, gate-result parsing, cleanup | Neutral review-session interface, plan revisions, trusted human approval |
| `@bridle/slack` | Raw-body signature/timestamp verification, Slack payload decoding, outbound Distilled calls | Neutral source/conversation interface, task correlation and authorization |
| `@bridle/openai` | OAuth/PKCE exchange and refresh protocol, subscription backend and model client | User ownership, refresh serialization, grants, billing policy |
| `@bridle/github` | Installation/token exchange and repository API operations | Repository allowlists, task grants, no-merge policy |
| `@bridle/cloudflare` | Storage/binding operations exposed through focused provider clients | Task/account/workspace schemas, storage semantics, record authorization |

Add operations when needed, not a mirror of every upstream SDK. Herdr's Effect-version compatibility boundary belongs here. Node-only implementations stay behind separate subpaths; a provider package's name or a fetch-shaped interface does not establish Worker compatibility.

Provider packages can expose Effect services for their own clients. Those are provider-specific dependencies of domain implementation Layers, not the services the operator or application use cases consume. A package must never import a domain interface to implement it, even with `import type`.

The artifact store is not selected yet. Artifact publication/readback is a neutral capability under Tasks, not a tier-1 `artifacts` service. Its eventual domain implementation will use the selected storage provider package. Shared artifact values remain in Contracts. Do not delete dev boxes holding the only copy of accepted artifacts.

Alchemy stack/resource declarations and native Worker/DO entry methods remain in apps. This does not move deployment composition into a Cloudflare client package or allow app-local provider code to absorb domain-to-provider translation.

## 4. Tier 2: provider-neutral services and their implementations

Four domain packages remain the proposed grouping. Each can contain several focused capability modules. Provider neutrality does not imply one domain package per provider or per Effect service.

### Contract, implementation, and default Layer

The happy path uses one focused service import:

```ts
import { Devbox } from "@bridle/executions/devbox"

Devbox.Service
Devbox.layer
Devbox.layerNoDeps
```

For a service with separate provider implementation modules, the internal layout can be:

```text
domains/executions/src/devbox/
  service.ts      canonical Devbox namespace: Service, layer, layerNoDeps
  contract.ts     single service tag and neutral Interface
  types.ts        inputs, results, Bridle IDs and lifecycle states
  errors.ts       errors callers can handle without knowing the provider
  namespace.ts    layerNoDeps plus layer composed with Namespace client defaults
```

`service.ts` re-exports the tag from `contract.ts`, the default Layers from `namespace.ts`, and its canonical namespace with `export * as Devbox from "./service"`. The implementation imports the contract, never `service.ts`, avoiding a public-module/implementation cycle. This is an example layout, not a requirement to split every small service into five files.

`@bridle/executions/devbox` maps to the public service module. Focused `/types` or explicit provider exports remain available when needed. A `/contract` export is an optional escape for real import-isolation needs, not the happy path. There is no required `/layer` import.

The domain defines its contract using Effect v4 `Context.Service`. Its provider implementation constructs a Layer for that same service. It translates inputs, results, lifecycle observations, identifiers, and errors into the domain vocabulary. A caller requests a devbox operation, not a Namespace instance operation. Provider IDs and persisted provider bindings remain implementation details, with sanitized diagnostics available for investigation.

The public service module exposes the default implementation alongside its neutral service, so its import closure may include provider code. Only the internal contract must remain implementation-free. Apps use `Devbox.layer` or select an explicit alternative and supply configuration, credentials, and runtime resources. Provider configuration can appear in implementation construction; it must not become required fields or SDK types in ordinary service methods.

Domain business logic uses the neutral service, even when it lives in the same package as the implementation. A provider replacement changes the selected Layer and its configuration, not that logic. It may still require migrating stored provider associations or letting existing attempts finish with their original provider.

Do not reduce the interface to whatever all providers happen to support. Define the operations Bridle needs, including readiness, waiting, and cancellation semantics. An implementation must honor the contract or explicitly report an unsupported capability. It must not silently weaken approval, reuse, or cancellation guarantees.

Proposed capability/default mapping:

| Neutral domain capability | Default implementation module | Provider package |
| --- | --- | --- |
| `executions/devbox` | `executions/devbox/namespace` | `namespace` |
| `executions/sessions` | `executions/sessions/herdr` | `herdr` |
| `executions/plan-review` | `executions/plan-review/plannotator` | `plannotator` |
| `tasks/conversation` | `tasks/conversation/slack` | `slack` |
| `accounts/connections` | `accounts/connections/openai` | `openai` |
| `workspaces/repositories` | `workspaces/repositories/github` | `github` |
| `tasks/store` | `tasks/store/cloudflare` | `cloudflare` |

These are capability locations, not new packages. Artifact and account-store implementations follow the same pattern once their stores are selected. For model inference, reuse Effect's provider-neutral `LanguageModel` contract rather than inventing another model protocol. `executions/model/openai` can assemble its default Layer using `packages/openai`; the operator remains provider-neutral.

### Minimal default path

Default dependency wiring belongs to the module that owns the service, not to every caller. For an agent service using the neutral sessions service, the composition is schematically:

```ts
// Normal composition, exported by the owning module.
export const layer = layerNoDeps.pipe(
  Layer.provide(Sessions.layer),
)

// Test composition, using the same agent implementation.
const integrationLayer = layerNoDeps.pipe(
  Layer.provide(SessionsTest.layer),
)
```

`Sessions.layer` already supplies its chosen session implementation and provider-client defaults. The agent-service consumer does not reconstruct that graph. The snippet illustrates composition, not implemented Bridle exports; required execution context or host resources remain explicit in the actual Layer type.

Apply the same pattern to entrypoint assembly. The operator/control default Layers compose the relevant domain defaults. The app supplies the remaining host bindings, remote capabilities, authorized credentials, and configuration once. A service call just requests its service from Effect; it does not construct a Layer or a new runtime.

`layerNoDeps` means the implementation has not been given its dependencies. Its requirement type still lists them. Use it for alternate providers or integration tests that keep real domain logic while replacing dependencies. To test against real providers, use the chosen implementation with explicit integration configuration. A reusable `layerTest` can follow when useful; none is required now.

Do not try to override an embedded default dependency by merging a test Layer next to the composed `layer`. Recompose from `layerNoDeps` at the affected boundaries, or replace the entire neutral service. There must be no hidden production client left in a test composition merely because it came from a higher-level default.

A fully bundled default should need no additional services where practical. Exceptions must describe real authority, configuration, or runtime needs. In particular, the operator's devbox composition uses a remote task capability, not the task domain's authoritative Cloudflare implementation. Default composition cannot cross upward into an app to obtain a remote adapter.

Reuse the resulting graph for the runtime's lifetime, with scoped cleanup and appropriate user/task isolation. The full convention, including memoization and runtime ownership, is in [the architecture rules](../architecture/CONTEXT.md#default-layers-and-test-composition).

### `@bridle/workspaces`

Own workspace configuration and access policy:

- Workspace membership and roles, referring to canonical user IDs.
- Allowed repositories, GitHub installation/access policy, and environment/profile references.
- Repository-access grants for executions. The domain's GitHub implementation uses `@bridle/github` for token operations; apps supply secret bindings. The deployment identity, model-provider connection, and GitHub execution identity are not interchangeable.
- Source installation associations and where installation secrets are referenced.
- Selected process configuration, role overrides, limits, and configuration revisions.

Expose operations such as resolve configuration, check whether a user may start work, and produce a configuration snapshot. Do not implement Slack signature verification, OAuth token exchange, agent prompting, or next-stage selection here.

The operator's default prompt assets live with its entrypoint, because they describe that entrypoint's tool interface. Workspace configuration selects/overrides those assets. Resolve and record a process snapshot when the task starts so later config edits do not silently change an in-progress task.

### `@bridle/accounts`

Own canonical people, external identity links, and user-owned model-provider connections:

- Mapping a verified Slack actor to a Bridle user.
- Initiating and completing a correlated provider login.
- Cached connection state, token renewal, revocation, and reconnect-required outcomes.
- Scoped use of an owned connection through an authorized execution grant.

The public connections interface is provider-neutral. Its OpenAI implementation Layer imports `@bridle/openai` for OAuth/token exchange and refresh, maps provider outcomes, and applies the domain's ownership and credential-lifecycle rules. Protocol communication does not live inline in the domain. Start from the existing Erudane pattern, not a new generic authentication framework.

The control entrypoint combines account ownership with workspace membership policy before granting task access. Accounts does not import Tasks or Workspaces just to discover permission indirectly. Untrusted callers cannot manufacture the trusted internal grant command.

Persist credentials outside disposable dev boxes. Give one durable owner responsibility for refresh-token rotation; a process-local cache or mutex is insufficient across replicas. The concrete credential store and serialization mechanism belong to the infrastructure plan. Dev boxes should not receive independent copies of a refresh token to rotate concurrently.

Slack installation tokens and users' OpenAI connections are different identities with different lifecycles. Answering a task question grants neither credential access nor permission to change the task's model account.

### `@bridle/tasks`

Own the authoritative record of requested work:

- Request, origin conversation, initiating user, repository/process snapshot, and execution references.
- Operator-reported progress and explicit waiting/intervention/final-review states.
- Pending questions and correlated human responses.
- Immutable plan revisions, review capabilities, trusted approval decisions, and approved artifact references.
- Findings, responses, dispositions, and review evidence for a specific code revision.
- Outbound notification intent and its delivery outcome.
- Neutral conversation and artifact capabilities, with provider implementation Layers under their own subpaths.

`/conversation` defines normalized incoming source events and outgoing messages without Slack DTOs. Its `/slack` implementation maps verified provider events and outgoing domain messages, using the provider package for communication. It does not decide who may start a task. The HTTP route and source registry remain in Control; raw HTTP requests are not added to the public conversation service.

`/artifacts` owns immutable publication/readback and task artifact authorization. Shared references/digests live in Contracts. Executions collects result candidates; entrypoints combine that with artifact publication and recording accepted evidence. Executions does not import Tasks just to upload bytes.

The task service enforces facts such as approval being for the current plan revision and an observation belonging to the active execution. It does not decide which agent should run next, whether a proposed fix is good, or whether a repeated finding is relevant. The operator makes those judgments and records their outcome.

Do not expose unrestricted `setStatus` or generic record mutation. Use meaningful commands with correlation and expected-revision checks. There is no merge command.

The Cloudflare Task DO hosts this domain's authoritative implementation. The dev-box runtime uses a restricted remote task capability for reading, reporting work, requesting questions/reviews, and asking for handoff. It cannot approve plans, change account ownership, or rewrite execution authority. Trusted human-approval acceptance is a separate control-only capability, not merely a hidden operator tool.

**Do not run a second task service over a remote persistence port.** That would duplicate business logic and turn one authoritative transaction into several network requests.

### `@bridle/executions`

Own carrying out an assigned attempt and collecting trustworthy execution observations, without judging the code's correctness.

Use focused modules inside one package:

- `/attempts`: durable attempt identity, devbox assignment, provisioning intent/outcome, active generation, and accepted observations. Runs on the control side.
- `/agents`: specialist roles/rounds, invocation identity, result-file validation, continuation, and cancellation. Runs in the dev box using the neutral sessions capability.
- `/devbox`: provider-neutral environment lifecycle, readiness, connectivity, and keepalive. The `/namespace` Layer maps this to Namespace.
- `/sessions`: provider-neutral terminal-session operations, readiness, submission, observation, and cancellation. The `/herdr` Layer maps this to Herdr.
- `/plan-review`: provider-neutral review-session lifecycle and observed decisions. The `/plannotator` Layer maps this to the supervised CLI/backend.

Their lifetimes differ, so do not hide both behind a single service requiring every dependency on both hosts. Do not split them into independent domains yet: they describe one execution attempt and share its protocol and reconciliation rules.

The task DO also stores the authoritative execution records associated with its task. Local journals, files, native agent histories, and Herdr state are execution evidence/checkpoints, not a second authoritative task record. Observers report outcomes with attempt, invocation, and code-revision identity. The control side rejects stale generations and duplicate observations.

Provider implementation modules call the corresponding tier-1 provider clients; public service modules expose their default Layers. Attempt/agent logic requires the domain's neutral devbox/session/review services and does not call provider clients. Host-specific Layer implementations must remain outside the opposite host's import closure. This domain does not depend on Tasks, Accounts, Workspaces, Slack, or the operator loop.

A plan-review service reports UI readiness and an observed gate outcome; it cannot grant authoritative approval. Tasks still requires a trusted gateway decision bound to the exact revision. Changing Plannotator must not change that rule. A long-running review is a scoped operation, not a Layer acquisition that blocks until a human decides.

### Domain relationships

Start with no domain-to-domain implementation imports. Shared identities cross through tier 1; domain-specific types can be imported downward by entrypoints/apps. If a real one-way domain dependency emerges, it is legal, but record why the depended-on concept is lower-level. Do not manufacture an interface solely to avoid an honest one-way dependency.

Task start, login authorization, review handoff, and provisioning combine domains. Those use cases belong in `entrypoints/control`, not a fifth all-knowing orchestration domain.

## 5. Tier 3: assemble the product into interfaces

### `@bridle/control`

Own public HTTP/WebSocket contracts and trusted application use cases. Start with internal directories for `sources/`, `tasks/`, `accounts/`, `reviews/`, and `execution/`; only create directories as their files become necessary.

The source registry and HTTP routes belong under `sources/`. The provider-neutral conversation/source capability belongs to Tasks, with its Slack implementation Layer in that domain and Slack protocol communication in `packages/slack`.

Ingress is a provider-specific boundary assembled by Control. Its Slack route passes the untouched body and headers to `@bridle/slack` for signature/timestamp verification and decoding. The domain's Slack adapter maps the verified event to neutral input values, event identity, and origin address before the shared use case runs. Control never verifies a re-serialized body or trusts caller-supplied actor IDs. This route wiring can know which source it serves; downstream business logic and the public conversation service cannot depend on Slack types.

For outbound delivery, Control calls the neutral conversation service. The domain's Slack implementation formats the message and calls `@bridle/slack`, which uses Distilled. Neither Control nor the operator imports the Slack SDK.

The control source inbox/index owns durable incoming event identity and conversation-to-task correlation, including the period before a task DO exists. Apps supplies its storage implementation. A process-local registry of adapter implementations is not this durable inbox. A retry must recover the original assigned task ID even if task creation or notification failed halfway through.

A source adapter does not itself start a dev box or choose the user connection. A shared control use case performs domain lookups and authorization after adapter verification. HTTP adapters need not pretend that every future input is an HTTP webhook; a future CLI can construct the same authenticated input command through its own transport.

Use an explicit code/config registry keyed by source kind and installation reference. Concrete adapters are wired by the app. Do not introduce runtime plugin discovery, a global mutable registry, or a lowest-common-denominator SDK abstraction.

Other control responsibilities include login callbacks, task commands, execution observation ingest/replay, notification delivery, and the public review gateway. The gateway verifies review capabilities and records a decision against a frozen plan before acknowledging trusted approval. Proxying Plannotator's UI does not grant access to its whole backend API.

The long-running operator does not live here. Short deterministic use cases may sequence membership check → task creation → provisioning request; they do not sequence planning → implementation → reviews.

### `@bridle/operator`

Own the agent-facing interface: the operator driver, its Effect toolkit, and the default Markdown process/role instructions.

It assembles capabilities such as task reading, agent work, finding submission, human questions, review requests, waiting, and final handoff. Tool implementations call domain services. They do not import Slack, Namespace, or Herdr SDKs directly.

The model chooses the next action. The driver validates/records requested actions, executes the relevant capability, appends results, and waits when instructed. A stopped model turn without a completion tool is not proof that the task is finished.

Long waits consume no repeated model calls. Scoped observers can wait for results or input for hours; event-driven same-session resume remains an alternative if the chosen model/tool transport cannot hold a call safely. Neither mechanism changes who decides the next stage.

Prompts are versioned assets of this entrypoint, for example `prompts/operator.md`, `prompts/planning.md`, `prompts/implementation.md`, and focused review/QA instructions. Workspace overrides and repository instructions are resolved into a task-specific snapshot. Store findings independently of prompt/session memory.

This package is tier 3 because it assembles several domains into the model's tool protocol. Putting it in `domains/operator` would create the forbidden middle horizontal described by the tier rules.

## 6. Tier 4: concrete runtimes

### `@bridle/api`

Defines the Alchemy Worker, task DO class/bindings, and final cloud Layer composition. Supplies native binding handles, secrets, and transport listeners. Selects domain implementation Layers, including the Cloudflare task-store and Slack conversation implementations. Domain-to-storage translation stays in the domain implementation; provider storage operations stay in `packages/cloudflare`.

Task and execution storage adapters can share one task object's SQLite database while exposing separate domain-owned ports. Cross-domain sequences use recorded intent, idempotent commands, and reconciliation; do not hold a database transaction across Namespace provisioning or a model call.

Workspace configuration, the source inbox/routing index, installations, user identity, and provider connections also require durable storage outside an individual task. Their database/DO layout is deliberately not selected by this package diagram. Do not hide those records in one task's database or an in-memory registry.

The native DO wrapper delegates product operations to domain services and protocol handling to `@bridle/control`. It must not become the only place where task behavior is defined.

### `@bridle/devbox`

Owns the process entrypoint and supervisor inside the Namespace image:

- Task assignment and scoped execution credentials.
- Environment/service readiness and keepalive through the neutral domain capability. Its Namespace implementation uses the provider package's explicit task markers.
- The domain's default session and plan-review Layers, currently Herdr and Plannotator, plus invocation observers.
- Remote task/account/control clients.
- Selection/configuration of the domain-exported model Layer and process lifecycle.
- Local checkpoint/session paths, status delivery, and shutdown/error reporting.

Use remote adapters for the task/account capabilities that must remain authoritative in the control service. Do not ship the credential store, refresh-token owner, cloud provisioner credentials, or authoritative task storage implementation into the dev-box bundle.

The supervisor runs independently of model turns and reports caught failures if the operator crashes. Full host loss still needs separate detection if reliable alerting is required. Approval service placement must also preserve a trust boundary from repository-controlled processes, even if both run in one VM.

### Root `alchemy.run.ts`

This is the deployment composition root and the one explicit consumer allowed to import app resource declarations. It combines provider/state Layers and app outputs. It is not imported by domains, entrypoints, packages, or app runtime code.

App-local files own their environment/binding types. Do not make lower-tier code import the root stack for inferred types. `alchemy.run.ts` is a narrow exception to “apps are imported by nobody,” not permission for app-to-app imports.

Alchemy deploys Bridle's long-lived infrastructure. A task begins through the running control API; it does not edit or redeploy the whole stack to allocate one dev box.

## 7. Import graph

Arrows mean imports, not network messages:

```text
alchemy.run.ts
  └─ apps/api
       ├─ entrypoints/control
       │    ├─ domains/workspaces
       │    ├─ domains/accounts
       │    ├─ domains/tasks
       │    └─ domains/executions/attempts
       ├─ selected domain implementation Layers
       │    └─ provider packages
       └─ native bindings/resources supplied to those Layers

apps/devbox
  ├─ entrypoints/operator
  │    ├─ domains/tasks capabilities
  │    └─ domains/executions/agents
  ├─ entrypoints/control/client
  ├─ domain capability tags used by remote adapters
  └─ selected domain session/review/model Layers
       └─ provider packages

domain business logic
  └─ provider-neutral domain capability contracts

domain provider implementation Layers
  ├─ their domain capability contracts
  └─ provider packages

packages/*
  └─ other tier-1 packages and external libraries, never domains/entrypoints/apps
```

`@bridle/control/client` must be a separate export that does not import server handlers, concrete source adapters, or app declarations. Remote domain adapters use contract-only exports where the normal service module would pull in the authoritative implementation or an incompatible default. These exports reuse the same service tag. This is an import-isolation exception, not the normal service import convention or a tier exception.

Apps close the final runtime requirements using composed defaults from the canonical service namespaces; they do not manually reconstruct every service's dependencies. Default provider implementations are exported by domains rather than recreated inside apps. The interfaces themselves do not depend on apps or provider packages, even though the public module also exposes a provider-backed default.

Validate the actual import closure for each host. A Node-only default cannot become Worker-safe merely because the consumer only uses `Service` or the bundler might remove unused exports. Use a compatible host default or a contract-only import at that boundary. App-specific remote clients still adapt Bridle's control protocol; they are not replacements for the domain-owned external-provider Layers.

## 8. End-to-end ownership checks

### Slack task start

Slack adapter verifies and normalizes → control resolves external actor and installation → Workspaces checks access/configuration → Accounts authorizes the selected user connection → Tasks creates the request/config snapshot → Executions records provisioning intent and creates/reconciles the assignment → dev box connects with its task/attempt identity → operator begins.

Persist the verified incoming event in the source inbox with stable identity before acknowledging Slack promptly. Task initialization and provisioning continue from that recorded work, each recording its own intent before external side effects. No cloud boot or model call may delay acknowledgement. A replayed event must find the same task/operation, not allocate another box.

### Review and fix loop

Operator chooses specialist work → local Executions assigns a round to a Herdr session → specialist publishes identified artifacts → Executions validates and reports the observation → Tasks records findings/evidence → operator decides which fixes or further reviews to request.

The reviewer observes an identified code revision. Implementation must not mutate that revision underneath an active review and then reuse the result as evidence for a different revision.

### Plan approval

Planner produces Markdown → a review revision/hash is recorded → local review process reports readiness → control publishes a scoped expiring review URL → a link holder submits a decision through the gateway → Tasks records the trusted decision against that revision → planner/operator receive the approved Markdown and outcome → operator chooses implementation.

The public token never grants Herdr/operator-control access. Its holder does not need an OpenAI login or workspace membership. Control proxies the existing devbox-hosted Plannotator UI; this is not a proposal to rebuild or relocate that UI into the Worker. A backend CLI exit, an agent-authored file, or an `approved` string alone cannot create trusted approval.

### Cached provider login

Verified user initiates connection → Accounts records OAuth state/correlation → provider callback completes through control → Accounts persists the user-owned connection → subsequent authorized executions obtain scoped usage → the credential owner renews and persists rotated credentials without another user login.

A Slack thread participant may answer questions without becoming the owner of the execution's provider connection. Never accept an arbitrary submitted Slack user ID as proof of identity during account linking.

## 9. What not to split yet

- Planning, implementation, each review specialty, and QA are roles and configuration, not separate domains or packages.
- Findings, questions, approvals, and handoff belong inside Tasks until they have genuinely independent lifecycle/use cases.
- Herdr workspaces and Namespace workspaces are provider concepts, not additional Bridle workspace domains.
- Do not create a separate package for each Effect service or each persistence port.
- Do not create a generic `db` package before selecting stores and identifying actual shared database mechanisms.
- Do not add a full multi-tenant admin UI, plugin marketplace, or workflow editor to justify the workspace model.
- `scripts/chatgpt` is local bootstrap code, not the authoritative cached-login implementation for a shared service. Reuse its protocol knowledge through Accounts rather than importing scripts into application packages.

## 10. Next planning steps

Approve or revise these ownership boundaries first. Then write the infrastructure plan around the actual stores, credential/approval trust boundaries, Namespace bootstrap/ingress path, and devbox image. Follow with precise Effect capability contracts and the implementation sequence.

Task credential selection, the Slack start gesture, final handoff channel, store/retention choices, and exact execution limits still need explicit decisions in their respective plans. In particular, this proposal does not silently choose the task starter's provider connection or a shared workspace default.

Compatibility work remains narrowly scoped: Distilled in the Alchemy Worker, Herdr's Effect prerelease mismatch, Namespace control transport, Erudane-style runtime refresh/model tools, and public Plannotator approval. The package design isolates these uncertainties instead of silently treating them as solved.

No application scaffolding, dependency changes, formatter runs, deployment, or commit is part of this proposal pass. Existing user changes, including vendored-source edits, are left untouched.
