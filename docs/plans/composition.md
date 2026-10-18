# Composition

Implemented on 2026-10-18. The rules are in [architecture](../architecture/CONTEXT.md#persistence) and the ownership in the [codebase proposal](codebase.md); this page records why and what remains.

## What was wrong

- `apps/api` held about 3,500 lines of business logic: dashboard operations, the operator alarm loop, ingress, installs, the broker and the provider registry.
- Every host re-wired the D1 binding and sealing key beside its domain layers, then built graphs by hand with `Layer.build` and `Effect.provideContext` on each call. Alchemy composes a [host from one Layer](https://alchemy.run/infrastructure-as-effects/layers.md) instead.
- Tables were spread over five domain files and one entrypoint, stitched together by three drizzle-kit configs, with no relations.

## What changed

- `@notus/db` owns the three stores' schemas, relations and migrations. `SharedDb.layer` declares the D1 database with a `Drizzle.Schema` resource and binds it with `Drizzle.D1`, which opens its client once per execution. `TaskDb` and `ConnectionDb` wrap `Drizzle.DurableObject`.
- `@notus/control/hosts` composes the Api Worker and the Task, Connection and Build objects. The app files are declarations: read configuration, provide infra once, return the host service.
- Control use cases (`Control`, `OperatorControl`, `ReadinessControl`, `Server`, `View`) are services, so host methods carry no call-time requirements beyond `RuntimeContext`.
- Platform specifics sit behind ports the app implements: `Durable` (gate, storage, alarm), `Sessions` (Better Auth), `Background` (`waitUntil`) and `Remote` tags for the object namespaces.

## Decisions that differ from the proposal

- JSON columns have no type in the schema, rather than `Schema.Json`. Domain types are mostly interfaces without index signatures, so they are not assignable to `Schema.Json`; the domain decodes on read either way.
- Durable Object migrations stay with committed drizzle-kit output and Drizzle's migrator. `Cloudflare.SqlMigrations` captures SQL when the Worker is built, so a `Drizzle.Schema` change generated during a deploy would reach the object one deploy late. Moving to Alchemy's migration engine adopts the existing `__drizzle_migrations` history one way; it is a separate change.
- The domain's `Connections.forward` takes a gate with requirements, so the host passes its own gate instead of re-providing a captured context.

## Not yet validated

A read-only `alchemy plan` on a personal stage completes: it creates `SharedSchema`, updates `SharedDatabase`'s migrations input and both Workers, and replaces nothing. Nothing has been deployed. Bundling `Drizzle.Schema` into the Worker follows Alchemy's D1 example but is unexercised here.
