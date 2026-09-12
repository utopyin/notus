# Cloudflare task coordination

Research date: 2026-09-12. Evidence is official documentation, not a deployed test. Cloudflare's Markdown endpoints were read directly after the web-scraping service hit its rate limit.

## Conclusion

One SQLite-backed Durable Object per task fits the proposed status, findings, human-request, and message-routing responsibilities. Keep the operator and hours-long tool waits in the dev box. A Durable Object's durable storage does not make its JavaScript promises, timers, or in-memory Effect fibers durable.

The recommended connection direction is **dev box to Durable Object**. The Durable Object accepts an inbound WebSocket using the hibernation API. This permits it to sleep while the dev box and its agents continue working. A Durable Object opening an outbound WebSocket to the dev box does not have the same hibernation behavior.

## Verified platform behavior

### Storage and object lifecycle

- Creating a stub does not instantiate an object. Calling the stub starts the object as needed.
- The constructor may run again after hibernation, deployment, or infrastructure restart.
- In-memory state is discarded during hibernation. There is no guaranteed shutdown hook for saving it at the last moment.
- SQLite-backed storage is transactional, strongly consistent, and private to an object. It exposes SQL and key-value methods. Cloudflare recommends SQLite-backed namespaces for new applications.
- SQL cursors should be fully consumed synchronously before an `await`; they do not preserve a snapshot across asynchronous boundaries.

Sources: [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

### WebSockets

- `ctx.acceptWebSocket(server)` and class handlers such as `webSocketMessage` enable hibernation. Standard event-listener WebSockets do not.
- An accepted socket can remain connected while the object sleeps. An incoming message reconstructs the object and invokes its handler.
- `serializeAttachment` preserves small per-connection metadata across hibernation, but attachments disappear when the socket closes. Store task data in object storage, not attachments.
- Hibernation only applies when the object is the WebSocket server. Outbound sockets do not hibernate.
- Deployments and shutdowns can terminate sockets. The client still needs reconnect and resynchronization.
- Protocol ping/pong handling can occur without invoking a model or waking the object. Application heartbeats may still be useful for stale-task detection but are a separate design choice.

Sources: [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

### Alarms and long-running requests

Each object has one scheduled alarm. An application can persist multiple deadlines and schedule the earliest. Alarm execution is at least once. Failed handlers get exponential-backoff retries, starting at two seconds, up to six retries.

The documented CPU budget is not a blanket wall-clock timeout for an open HTTP request. Current documentation lists no hard HTTP/RPC wall-time limit while the caller remains connected, but shutdown, disconnection, and deployment still matter. Alarm handlers have a 15-minute wall-time limit. None of these mechanisms makes an hours-long in-memory wait crash-resilient.

An alarm is optional for prototype health supervision, as agreed. It may separately be useful for retrying pending message delivery or cleaning up expired resources. Request-time expiry checks do not require an alarm. Do not turn optional supervision into an autonomous recovery engine without a product decision.

Sources: [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

### Node compatibility is not a Node host

Cloudflare exposes only a subset of Node APIs. Some imports succeed because nonfunctional stubs exist. In the current compatibility documentation, `node:http2` and `node:child_process` are among those stubs.

This is relevant to Namespace's Node-oriented SDK and to Herdr's local socket integration. A successful TypeScript build does not prove that those packages work inside a Worker. Keep local terminal control inside the dev box, and validate the Namespace provisioning path separately. See [Namespace research](namespace.md).

Source: [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

## Proposed message contract requirements

These are Bridle design recommendations, not built-in Durable Object features or a replacement for the operator's judgment.

- Authenticate incoming source webhooks before normalizing them. Scope task lookup by workspace as well as task ID.
- Give each external event, operator command, human request, and response a stable identifier. Source retries must not create extra tasks or launch implementation twice.
- Persist a received event before acknowledging it. Replayed events should return the previously recorded outcome.
- Record task status as the operator's report, with execution/session IDs and timestamps. A `reviewing` status does not prove that the review agent is still alive.
- Persist outbound notification intent separately from delivery outcome. A crash after sending but before recording success can duplicate a notification; do not promise exactly-once delivery without source-specific support.
- Scope dev-box credentials to one workspace, task, and execution attempt. Use an execution generation or equivalent identifier to reject messages from an obsolete operator process.
- On reconnect, exchange acknowledged sequence positions and replay missing events. A WebSocket reconnect must not reset unresolved human requests.
- Correlate answers with the exact pending question or plan revision. Duplicate, stale, and conflicting human responses need an explicit resolution policy.
- Keep large screenshots, videos, and terminal logs outside the task database. Store artifact references and bounded metadata in the object. The artifact store remains a design choice.

These requirements let deterministic code transport and record decisions while the operator continues to decide which tools to call and whether the task is ready for handoff.

## Prototype boundary

A transport disconnect is not the same as a dev-box crash. Minimal reconnect and replay are needed even if full automatic execution recovery is out of scope.

Without independent supervision, a completely lost dev box cannot notify Slack about its own failure. The initial implementation can report caught errors and mark disconnected executions as such, but should not claim reliable crash alerting until a heartbeat/deadline check exists.

## Validation before implementation commitments

1. Run a minimal Effect v4 service and Schema boundary inside a Worker and a SQLite-backed Durable Object. Pin the tested Effect and Wrangler versions.
2. Connect a test client as the dev box, let the object hibernate, then send a status event and a human reply. Confirm persistence and reconnection after a deployment.
3. Replay the same incoming task event and the same tool event. Confirm that task creation and recorded outcomes are not duplicated.
4. Disconnect between outbound notification and acknowledgement. Document actual delivery semantics for the chosen first adapter.
5. Reject wrong-workspace, expired, and obsolete-execution credentials. Keep plan-view bearer tokens separate from operator/control credentials.
6. Bound event sizes and avoid sending full terminal streams through the task object by default.

No Cloudflare resources were created and none of these tests has been run during this research pass.
