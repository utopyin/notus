# Alchemy source map

References for the Effect-based Alchemy API, not the older async API. Paths are relative to `repos/alchemy/`; pins are in [sources](sources.md). Deployment ownership follows [architecture](../architecture/CONTEXT.md).

| Need                               | Source                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack/provider/state composition   | `website/src/content/docs/getting-started.mdx`; `packages/alchemy/src/Stack.ts`                                                                    |
| Cloudflare stack example           | `examples/cloudflare-agent/alchemy.run.ts`; `packages/alchemy/src/Cloudflare/Providers.ts`                                                         |
| Durable Object declaration/binding | `website/src/content/docs/cloudflare/compute/durable-objects.mdx`; `packages/alchemy/src/Cloudflare/Workers/DurableObject.ts`                      |
| Hibernatable WebSockets            | `website/src/content/docs/cloudflare/compute/hibernatable-websockets.mdx`; `DurableObjectShape` in the source above                                |
| D1 resource / migrations           | `packages/alchemy/src/Cloudflare/D1/{Database,QueryDatabase}.ts`; `packages/alchemy/src/Drizzle/Schema.ts`                                         |
| Effect-native Drizzle adapters     | `packages/alchemy/src/Drizzle/{D1,Cloudflare}.ts`; `packages/alchemy/src/SQL/D1.ts`                                                                |
| Worker inbox recovery              | `packages/alchemy/src/Cloudflare/Workers/CronEventSource.ts`                                                                                       |
| Node container host                | `packages/alchemy/src/Cloudflare/Containers/{Container,ContainerPlatform}.ts`; `packages/alchemy/src/Runtime/Bootstrap/CloudflareContainerNode.ts` |

Constraints from inspection:

- `Alchemy.Stack` composes an Effect program with provider/state Layers. Deployment profiles are infrastructure credentials, not users' model-provider connections.
- Durable Objects expose typed RPC, fetch, alarm, and WebSocket handlers. Those types do not authenticate external messages or make in-memory Effect waits durable. See [Cloudflare](cloudflare.md).
- Container source binds a process to a DO and implements fetch-based RPC over its port; a Node bootstrap exists. Declaration and implementation must stay separate to avoid pulling Node dependencies into the Worker bundle. This documents optional container support, not a selected Notus runtime or proof of a working deployment.
- No Namespace Labs provider was found in the inspected provider tree. `src/Namespace.ts` is Alchemy's naming concept, not Namespace Labs support. A custom provider for shared Namespace configuration remains a possibility, not a prerequisite for runtime task provisioning.
- Upstream gitlinked dependencies are not initialized. This checkout is reference material, not a complete upstream build installation. Source examples/tests can create real resources.
- Matching declared Effect versions does not prove the actual installed build/runtime graph. Deployment state, stages, profiles, and resource topology remain infrastructure-planning choices. [Validation](validation-plan.md) covers the Worker/DO/package experiment.

## Drizzle and D1 integration

The installed Alchemy package's `src/Drizzle/{D1,Cloudflare}.ts` and D1 resource implementation were also inspected. [Sources](sources.md#compatibility-inventory) records the selected Drizzle version and Alchemy's different optional peer pin.

- `Cloudflare.D1.Database` accepts migration artifacts; `Cloudflare.D1.QueryDatabase` exposes its binding. `Drizzle.D1` uses `drizzle-orm/effect-d1` and builds/memoizes the SQL client per execution scope, not for the isolate lifetime. `SQL.D1Layer` also provides the Effect D1/SQL service tags.
- `alchemy/Drizzle/Cloudflare` exports `DurableObject`, backed by `drizzle-orm/effect-sqlite-do`. It opens the current object's SQLite database and applies supplied migration bundles before returning. Migration failure prevents usable initialization.
- `Drizzle.Schema` can generate migration SQL during deployment. Alternatively, D1 accepts a pre-generated directory via `migrations`. Alchemy owns D1's `__alchemy_migrations` ledger after application/adoption; do not mix independent migration runners on that database. DO migrations run at object initialization, not by migrating every object during deploy.
- Upstream fixtures cover Effect-native D1 queries and DO migrations/typed errors: `test/Cloudflare/D1/{Drizzle.test.ts,fixtures/drizzle-worker.ts}` and `test/Cloudflare/Workers/{DrizzleDurableObjectMigrations.test.ts,fixtures/drizzle-do/object.ts}`. Their test bodies were read, not executed.
- The pinned Effect D1 client exposes fixed atomic `batch`, but rejects interactive transactions. Drizzle's D1 `transaction` delegates to that unsupported operation; its presence is not proof it works. Evidence: `repos/effect/packages/sql/d1/src/D1Client.ts`, published Drizzle `effect-d1/session.js`.
- Alchemy's Effect cron event source catches handler failures, so do not rely on platform failure retries. Persistent inbox state, subsequent scheduled scans, and explicit error/lag reporting must provide recovery.
