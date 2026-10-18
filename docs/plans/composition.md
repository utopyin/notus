# Composition

Implemented on 2026-10-18 in two rounds. The rules are in [architecture](../architecture/CONTEXT.md#persistence) and the ownership in the [codebase proposal](codebase.md); this page records why and what remains.

## What was wrong

- `apps/api` held about 3,500 lines of business logic: dashboard operations, the operator alarm loop, ingress, installs, the broker and the provider registry.
- Every host re-wired the D1 binding and sealing key beside its domain layers, then built graphs by hand with `Layer.build` and `Effect.provideContext` on each call. Alchemy composes a [host from one Layer](https://alchemy.run/infrastructure-as-effects/layers.md) instead.
- Tables were spread over five domain files and one entrypoint, stitched together by three drizzle-kit configs, with no relations.
- After the first round, the entrypoint still knew it lived in a Worker: the API host returned a `fetch` plus thirty schemaless RPC methods taking a cookie argument, ports carried Alchemy's `RuntimeContext`, ingress took a record of functions, and the Task host was 950 lines.

## What changed

- `@notus/db` owns the three stores' schemas, relations and migrations. `SharedDb.layer` declares the D1 database with a `Drizzle.Schema` resource and binds it with `Drizzle.D1`, which opens its client once per execution. `TaskDb` and `ConnectionDb` wrap `Drizzle.DurableObject`.
- The API is HTTP. `@notus/control/api` exports its services and one `HttpRouter` layer per surface: dashboard Effect RPC at `/rpc` behind session middleware, ingress at `/:platform/events`, the dev box callback at `/runtime/:call`, the install bounce and the health check. The app serves them with `HttpRouter.toHttpEffect` and runs `Drain` on its schedule; Better Auth's routes are the app's own layer.
- The dashboard calls the API through `RpcClient` over its service binding. The contract, `@notus/control/dashboard/rpcs` and its `types`, imports schemas only; handlers live beside it, one module per area. Refusals are one `DashboardError` with a reason, which the dashboard's server functions return as the `{ ok, reason }` results its pages already read.
- Each object is a two-phase constructor in `@notus/control/objects`: construction reads configuration and takes the shared store and other objects' namespaces; the instance requires only its own store, durable state and recipe. The Task object's loop, dev box endpoint, credentials and control actions are services of their own (`Alarm`, `Endpoint`, `Tokens`, `Actions`).
- No entrypoint imports Alchemy. Ports (`Durable`, `Sessions`, the `Remote` tags) carry no platform type; the app's adapters run platform calls through `within`, in the calling execution. Ingress kicks the drain from a request-scope finalizer, which Alchemy runs after the response, instead of a `waitUntil` port.

Each app file is now a declaration of under 50 lines, except Better Auth's configuration.

## Decisions that differ from the proposal

- JSON columns have no type in the schema, rather than `Schema.Json`. Domain types are mostly interfaces without index signatures, so they are not assignable to `Schema.Json`; the domain decodes on read either way.
- Durable Object migrations stay with committed drizzle-kit output and Drizzle's migrator. `Cloudflare.SqlMigrations` captures SQL when the Worker is built, so a `Drizzle.Schema` change generated during a deploy would reach the object one deploy late. Moving to Alchemy's migration engine adopts the existing `__drizzle_migrations` history one way; it is a separate change.
- The domain's `Connections.forward` takes a gate with requirements, so the host passes its own gate instead of re-providing a captured context.
- The dashboard's RPC is a route on the public API Worker rather than a private Worker of its own. Every call is authenticated by the session cookie, which belongs to the dashboard's origin. A separate `RpcWorker` bound only to the dashboard would keep it off the public origin, at the cost of binding the objects across scripts.
- The binding-only Worker methods `snapshot`, `inboxSnapshot`, `configureEnvironment`, `connectionStatus` and `revokeConnection` took no session and had no caller in the repository. They are not carried onto HTTP.
- Object methods still answer with `{ ok, reason }` values rather than typed errors, as before.

## Not yet validated

A read-only `alchemy plan` on a personal stage completes: it creates `SharedSchema`, updates `SharedDatabase`'s migrations input and both Workers, declares no other property change, and replaces nothing. Nothing has been deployed.

The routes were exercised in Bun with stubbed services through `HttpRouter.toWebHandler` and the dashboard's client setup: anonymous and signed-in `me`, a refused call without a session, refusal reasons, the callback's 401 and 404, an admitted delivery whose drain ran after the response, and the install bounce. Workerd itself is unexercised: the per-request RPC server, the request-scope finalizer through `waitUntil`, and `Drizzle.Schema` bundled into the Worker.
