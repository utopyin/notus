# Architecture rules

Agreed code conventions. [Product context](../../CONTEXT.md) defines behavior; the [codebase proposal](../plans/codebase.md) assigns concrete package ownership.

## Tiers and dependencies

| Tier | Directory      | Responsibility                                                       |
| ---- | -------------- | -------------------------------------------------------------------- |
| 1    | `packages/`    | Provider communication, reusable mechanisms, genuinely shared values |
| 2    | `domains/`     | Provider-neutral services, domain behavior, implementation Layers    |
| 3    | `entrypoints/` | Assemble domains into application protocols and interfaces           |
| 4    | `apps/`        | Runtime startup, bindings, and final configuration                   |

- Import downward or sideways, never upward; no cycles, including within a tier. Use the term **tier**, not layer, for these directories.
- Packages are named `@notus/<directory>`, so names must be unique across tiers.
- A domain owns a concept end to end. Cross-domain application assembly belongs in entrypoints, not an all-knowing domain service.
- Keep domain contracts/types/errors with their owner. Extract shared values into tier 1 only when independent owners need them; an entrypoint importing a domain type is already legal.
- Apps are not imported by other packages. The root `alchemy.run.ts` may import app resource declarations; nothing imports the root stack, even for types. Binding types remain app-local.
- `repos/` and development `scripts/` are outside the application graph and are not application dependencies. Dependency enforcement is currently manual.

## Provider boundary

```text
domain service module
  ├─ neutral contract
  └─ implementation Layer → provider package → SDK / API / CLI
          └─ same neutral contract
```

Provider packages own communication, wire decoding, protocol authentication, and provider-specific failures. They never import domain tags, including type-only imports.

Domains own service interfaces and implementation Layers that translate provider requests, IDs, results, lifecycle observations, and errors. Public methods do not expose SDK types or require callers to understand vendor configuration. Business logic calls neutral capabilities, not provider clients. Define the behavior Notus needs; do not silently weaken it to accommodate a provider.

Provider configuration crosses those boundaries as a provider key and opaque JSON. Only the provider package decodes, encodes, or validates its native settings. Domain storage may validate and serialize JSON, but must not extract a blueprint reference, translate machine settings, or discard unfamiliar fields. Keep credentials and execution authority separate from reusable configuration.

## Services and Layers

Use Effect v4 `Context.Service` and one canonical namespace per focused service module:

```ts
import { Devbox } from "@notus/executions/devbox";

Devbox.Service;
Devbox.layer;
Devbox.layerNoDeps;
```

Use file-local names such as `Interface`, `Service`, and `layer`, projecting the namespace with `export * as Devbox from "./service"`. No separate `/layer` import is required. Keep provider-specific imports for explicit alternatives.

| Export        | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `layer`       | Chosen implementation with sensible default dependencies supplied recursively  |
| `layerNoDeps` | Same implementation with dependencies unprovided, for substitution/composition |
| `layerTest`   | Optional reusable test composition, added when needed                          |

The default should be self-contained where reasonable. Leave genuine runtime bindings, authorized credentials, and configuration explicit; never invent authority or fall back to another billing mode to close a dependency type. Cross-domain defaults belong in entrypoints. Apps close remaining host requirements once, not at each service call.

Use `Layer.provide` to supply private dependencies. Use `provideMerge` only when consumers need those dependencies too. For tests, compose `layerNoDeps` with replacements or provide a replacement for the entire service tag. Merging a test dependency beside an already-composed production Layer does not override its internal dependency.

Build the top-level graph once per owning runtime lifetime. Reuse stable Layer values within that graph for memoization, scope resources and background work, and dispose runtimes appropriately. Do not create private global runtimes, initiate provider work on import, or accidentally share captured credentials between users/tasks.

Implementation patterns: [Effect skill](../../.agents/skills/effect/references/SERVICES_LAYERS.md), [default composition](../../repos/effect/ai-docs/src/01_effect/03_services/20_layer-composition.ts), [test composition](../../repos/effect/ai-docs/src/09_testing/20_layer-tests.ts).

## Persistence

`@notus/db` owns every table, relation and migration, one store per database: `shared` (D1), `task` and `connection` (Durable Object SQLite). The database shape is one domain. Each store exports a `Service` typed with its relations and an infra `layer` that declares and binds its database. Domains query through the store tag; they never declare tables.

Tables hold storage shapes. JSON columns are untyped in the schema; the owning domain decodes them at its boundary, typically through `createSelectSchema` overrides in its `rows.ts`. A store never imports domain types.

Shared migrations are generated on deploy by Alchemy's `Drizzle.Schema`. Durable Object migrations are generated with `packages/db/drizzle.<store>.ts` and committed, because an object captures its SQL when its Worker is built.

## Runtimes

Entrypoints are neutral about where they run: no Alchemy, Worker or object types. The app declares each runtime, binds its resources, and provides the control plane's layers once.

- **The API is HTTP.** `@notus/control/api` exports `layer`, its services, and `routes`, one `HttpRouter` layer per surface. Each surface owns its transport and authority: Effect RPC for the dashboard at `/rpc`, authenticated by session middleware; platform ingress, by the platform's signature; the dev box callback, by its capability; the install bounce, by nothing. The app serves `HttpRouter.toHttpEffect(routes)` as its `fetch` and schedules `Drain`.
- **A client imports a contract.** An RPC group and its wire schemas live in modules that import schemas only, so a client's bundle never carries server code.
- **An object is a two-phase constructor.** `@notus/control/objects/<object>` exports its `Service` (the object's RPC shape), a `Remote` tag addressing other instances, and `make`. Construction reads configuration and takes what outlives the instance, such as the shared store; it returns the instance's effect, which requires only the object's own store, durable state and recipe. The app's object class yields `make` and provides those.
- **Ports carry no platform types.** `Durable`, `Sessions` and the `Remote` tags are neutral. The app's adapters run platform calls through `within`, in the execution that called them.

Composition:

- Dependencies are services in Context, never records of functions passed to a handler. A layer reads the configuration it needs, in the construction phase, where Alchemy binds what is read.
- No `Layer.build` or `Effect.provideContext` in `apps/` or `entrypoints/`. A service resolves its dependencies at layer construction; use cases that read services are themselves services.
- Construction holds nothing disposable. Request-scoped resources, such as D1 clients and RPC servers, are acquired per execution. Work after the response is a finalizer on the request's scope.
- A binding is declared in the construction phase. A Durable Object takes the shared store from its construction phase into its instance.

## Import isolation

A provider-neutral API is not necessarily an SDK-free import: the public module also exposes defaults.

When separate implementations need the tag, define it once in an internal `contract.ts`. Implementations import that contract, never the public module that re-exports them. Expose a contract-only subpath only when a cross-runtime consumer needs isolation; it is not the happy path.

Check the full import closure for the target host. Tree-shaking or dynamic imports do not guarantee Worker compatibility. Use compatible host defaults or isolated contracts where necessary. Defaults must preserve the [runtime authority boundaries](../plans/codebase.md#runtime-and-data-ownership), not bundle control-only services into a dev box.
