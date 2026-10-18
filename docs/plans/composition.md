# Composition proposal

Proposal, not implemented. It changes how hosts are composed and where tables live. Once agreed, the rules move into [architecture](../architecture/CONTEXT.md) and the ownership moves into the [codebase proposal](codebase.md).

## What is wrong today

- **Apps hold business logic.** `apps/api/src/api.ts` (1134 lines) implements about 50 dashboard operations: session checks, workspace authorization, profile joins and task listing. `apps/api/src/task.ts` (995 lines) assembles the operator round, provisioning and runtime callbacks. `platforms.ts`, `runtime.ts`, `compute.ts`, `broker.ts`, `ingress.ts`, `install.ts`, `callback.ts`, `recipe.ts` and `crypto.ts` are cross-domain assembly, which [architecture](../architecture/CONTEXT.md#tiers-and-dependencies) assigns to entrypoints.
- **Infrastructure is not isolated.** Each host repeats `Layer.effect(D1.Binding, shared.raw)` and `Sealed.layer(credentialKey)` next to domain layers: three times in `task.ts`, twice in `connection.ts`, and again in `api.ts` and `build.ts`. Whether a host runs in a Worker, the Task DO or the Connection DO depends on hand-written wiring, not on the layers it is given.
- **Graphs are built by hand at runtime.** `apps/` and `entrypoints/` contain 44 `Layer.build` / `provideContext` calls. Hosts build a context and then pull services out of it one at a time. [Alchemy's layer model](https://alchemy.run/infrastructure-as-effects/layers.md) instead has the constructor `yield*` services and the host provide a single composed Layer. The `api.ts` comment "build this graph in each execution" works around D1 client lifetime. Alchemy's `Drizzle.D1` already handles that: it builds the client lazily, at most once per execution scope (`repos/alchemy/packages/alchemy/src/Drizzle/D1.ts`).
- **The database has no schema object.** Tables are spread across `domains/{accounts,workspaces,tasks,executions}/src/schema.ts`, `domains/accounts/src/connection.ts` and `entrypoints/control/src/schema.ts`. Three drizzle-kit configs in `apps/api` stitch them together. There are no `defineRelations`. `@notus/cloudflare/d1` and `/sqlite` hand out an untyped `EffectSQLiteD1Database` / `EffectSQLiteDoDatabase`, so `db.query.*` with relations is not available.

## Target shape

### `@notus/db`: one owner for stores, schemas and relations

```text
packages/db/
  shared/   schema.ts relations.ts service.ts   → D1 (accounts, workspaces, inbox)
  task/     schema.ts relations.ts service.ts   → Task DO SQLite (tasks, executions)
  connection/ schema.ts relations.ts service.ts → Connection DO SQLite
  migrations/{shared,task,connection}/
  drizzle.{shared,task,connection}.ts
```

Each store follows the [service convention](../architecture/CONTEXT.md#services-and-layers):

```ts
import { SharedDb } from "@notus/db/shared";

SharedDb.Service; // Drizzle database typed with the store's relations
SharedDb.layer; // infra Layer: declares the D1 resource, binds it, opens Drizzle.D1 with relations
```

- `SharedDb.layer` owns the resource, following Alchemy's pattern. `Cloudflare.D1.Database` (migrations under `packages/db/migrations/shared`), `Cloudflare.D1.QueryDatabase` and `Drizzle.D1(d1, { relations })` live inside one `Layer.effect`. `apps/api/src/database.ts` goes away. A host that provides the Layer gets the binding automatically.
- `TaskDb.layer` / `ConnectionDb.layer` wrap `Drizzle.DurableObject({ migrations, relations })`. They require `DurableObjectState`, so the type system confines them to the Durable Object's instance effect.
- Domains depend only on the `Service` tag and its tables. They own queries and behavior, not table definitions. `@notus/cloudflare/d1` and `/sqlite` are deleted. `batch` and `query` (11 call sites) become thin helpers on the store service, or plain Drizzle `db.batch` if the effect-d1 driver supports it (still to check).

This deliberately departs from "a domain owns a concept end to end" for persistence. Relations cross domains (task ↔ attempt, workspace ↔ membership ↔ user), and one schema module per store is what Drizzle and the migration tooling consume anyway.

### One composed Layer per host, provided once

| Host          | Composition owner                 | Infra the app provides                                           |
| ------------- | --------------------------------- | ---------------------------------------------------------------- |
| Api Worker    | `@notus/control/hosts/api`        | `SharedDb.layer`, sealing key, config, DO namespaces             |
| Task DO       | `@notus/control/hosts/task`       | `TaskDb.layer`, `SharedDb.layer`, sealing key, config, Connection |
| Connection DO | `@notus/control/hosts/connection` | `ConnectionDb.layer`, `SharedDb.layer`, sealing key, config      |
| Build DO      | `@notus/control/hosts/build`      | `SharedDb.layer`, sealing key, config                            |

Each entrypoint host module exports a `Service` whose interface is the RPC surface the host serves, plus a `layerNoDeps` whose remaining requirements are only infra tags. The app file then becomes declaration plus one provide:

```ts
export class Task extends Cloudflare.DurableObject<Task>()(
  "Task",
  Effect.gen(function* () {
    return Effect.gen(function* () {
      return yield* TaskHost.Service;
    }).pipe(Effect.provide(TaskHost.layerNoDeps.pipe(Layer.provide(infra))));
  }),
) {}
```

Rules this introduces:

- No `Layer.build` or `Effect.provideContext` in `apps/` or `entrypoints/`. Constructors `yield*` services; providing happens once, at the host. Legitimate per-call layers, such as the initiator's broker-backed `LanguageModel`, use `Effect.provide` around the call that needs them, never a hand-built context.
- RuntimeContext is not captured at init and reinjected with `Layer.succeed(RuntimeContext, …)`. Methods that need it declare it and get it from the handler, as Alchemy's types intend.
- An infra Layer (database, sealing key, DO namespace) is defined once and imported by every host that needs it. Hosts do not rebuild bindings.

### What remains in `apps/api`

Resource declarations (Worker, DO classes, the dashboard binding), `config.ts`, the infra Layers that need app-local values, and the map from RPC methods to host service calls. Everything else listed under "What is wrong today" moves to `entrypoints/control`.

## Sequence

Each step is one reviewable commit that type-checks and deploys.

1. **`@notus/db`.** Move tables, add relations, move migrations and drizzle configs, and add the three store services and infra layers. Switch domains from `D1.Service`/`Sqlite.Service` to the store tags. Check: `drizzle-kit generate` produces no new migration for any store.
2. **Host composition.** Replace hand-built graphs in `build.ts`, `connection.ts`, `task.ts` and `api.ts` with one Layer per host. Check that D1 clients stay per execution, including the cron drain inside `waitUntil` that the current comment protects.
3. **Logic out of the app.** Move dashboard operations, ingress, install, callback, broker, platforms and runtime wiring into `entrypoints/control` host modules.
4. **Rules.** Fold the rules above into architecture and update the codebase proposal's ownership tables.

## Open questions

- Domain types in JSON columns. `tasks/schema.ts` and `executions/schema.ts` type JSON columns with domain schemas (`Input`, `Reservation`, `Mode`, `Attachment`, `DeliveryOutcome`, `Environment`, `ResolvedInstructions`). A tier-1 `@notus/db` cannot import them, and domains importing `@notus/db` rules out a tier-2 placement too (cycle). Options: (a) store JSON columns as `Schema.Json` and have domains decode at their boundary, keeping `createSelectSchema` overrides in the domain; (b) move those value schemas into `@notus/contracts`. Recommendation: (a). The table stays a storage shape and the domain keeps its types.
- Should migrations be generated by Alchemy's `Drizzle.Schema` resource on deploy, or stay with the checked-in drizzle-kit configs? Both use the same directory format.
