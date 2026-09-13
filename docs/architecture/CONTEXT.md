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

## Import isolation

A provider-neutral API is not necessarily an SDK-free import: the public module also exposes defaults.

When separate implementations need the tag, define it once in an internal `contract.ts`. Implementations import that contract, never the public module that re-exports them. Expose a contract-only subpath only when a cross-runtime consumer needs isolation; it is not the happy path.

Check the full import closure for the target host. Tree-shaking or dynamic imports do not guarantee Worker compatibility. Use compatible host defaults or isolated contracts where necessary. Defaults must preserve the [runtime authority boundaries](../plans/codebase.md#runtime-and-data-ownership), not bundle control-only services into a dev box.
