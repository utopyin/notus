# Cloudflare platform constraints

Official platform constraints. [Alchemy](alchemy.md) covers deployment APIs; [the codebase plan](../plans/codebase.md) assigns data ownership.

## Storage and reconstruction

- Creating a stub does not instantiate the object; calling it does. Constructors run again after hibernation, deployment, or restart. In-memory state disappears and no shutdown hook reliably saves it.
- SQLite-backed storage is transactional, strongly consistent, and private per object. Cloudflare recommends SQLite for new namespaces. Consume SQL cursors synchronously before an `await`; they do not retain snapshots across asynchronous boundaries.
- Durable storage does not persist JavaScript promises, Effect fibers, timers, or a pending human-approval callback.

Sources: [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [SQLite API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## WebSocket direction matters

- An inbound devbox-to-DO socket can use `ctx.acceptWebSocket` and class handlers for hibernation. Standard event-listener sockets do not. Outbound sockets from the DO cannot hibernate.
- Accepted sockets can remain connected while the object sleeps; messages reconstruct it. Attachments preserve small connection metadata, but disappear on socket close. They are not task storage.
- Deployments/shutdown can still close sockets. Reconnect needs persisted cursors and replay; reconnection alone does not preserve a human reply or reject an obsolete execution.
- Protocol ping/pong can avoid waking the object. Application heartbeats and reliable host-loss detection are separate choices. A lost devbox cannot report its own destruction.

Source: [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## Alarms, delivery, and runtime limits

- An object has one scheduled alarm. Applications can store several deadlines and schedule the earliest. Alarm execution is at least once; failed handlers retry with exponential backoff, starting at two seconds, up to six retries.
- CPU budgets are not blanket HTTP wall-time limits. Reviewed docs list no hard HTTP/RPC wall-time cap while the caller stays connected, but deployments/disconnections still interrupt work. Alarms have a 15-minute wall-time limit. None makes in-memory long waits durable.
- Persisted expiry checks do not require an alarm; retry/cleanup scheduling and optional health supervision are separate uses.
- Storage transactions cannot atomically commit an external notification. A crash after send but before recording delivery can duplicate it. Do not promise exactly-once source-provider effects from DO consistency alone.
- Node compatibility includes nonfunctional modules such as `node:http2` and `node:child_process`. Successful imports/typechecks do not establish a Node host. Namespace's socket-dependent HTTP transport has an additional mismatch; see [Namespace](namespace.md#control-transport).

Sources: [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).
