# Namespace integration evidence

Source paths are relative to `repos/namespace-sdk/`; pins and distribution gaps are in [sources](sources.md). Generated fields establish client/protocol shapes, not server support. The [validation plan](validation-plan.md) defines the control/bootstrap experiment.

## Control transport

The [rechecked npm archive](sources.md#compatibility-inventory) exposes `@namespacelabs/sdk/proto/namespace/private/devbox/devbox_pb`, including `DevBoxService`, without the newer high-level devbox wrapper. Its inspected local descriptor imports depend only on protobuf codegen/WKT externally. This gives the direct Worker experiment a published descriptor path, without importing the SDK's Node transport or vendored source. A fetch-based Connect client and live API access remain untested.

- `src/devbox/index.ts` exposes `createDevboxClient`. The Devbox endpoint defaults to `https://private-api.iad.namespaceapis.com`, overridable by `NSC_DEVBOX_ENDPOINT`. Endpoint selection does not select machine location; request `site` does. `client.close()` closes cached connections, not resources.
- Lifecycle RPCs use Connect JSON over HTTP/1.1 through connect-node. The inspected dependency's `dist/esm/node-universal-client.js`, `h1Request`, waits for Node's `socket` event before writing. Workers [does not support that event](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/#other-differences-between-node-js-and-workers-implementation-of-node-http).
- Exec uses native gRPC HTTP/2 over a WebSocket-backed Node Duplex. Workers' [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) has no functional `node:http2`. SSH/SFTP uses `ssh2`, `ws`, and streams. Compatibility flags or successful imports do not supply these semantics.
- `createDevboxClient({ transport })` replaces control RPC transport only. Agent/SSH/display connections still construct their own transports, require credentials separately, and enter the root and `/devbox` import closure. Evidence: `src/devbox/connection.ts`, `src/api/clients.ts`, `src/devbox/display.ts`.
- A fetch-compatible unary subset is a candidate, using published descriptors and [Connect protobuf JSON](https://connectrpc.com/docs/protocol/#unary-request), not generic serialization of SDK objects. Service path is `/namespace.private.devbox.v1beta.DevBoxService/{Create,Fetch,Activate,Stop,Expire}`. Confirm support/stability of this private API with Namespace. The agent's synthetic `http://devbox-agent` authority is not a public endpoint; do not POST `RunExec` to the control API.
- The fallback candidate is a trusted Node SDK/CLI control adapter outside disposable devboxes. Choosing between these belongs to validation, not an assumption that Workers runs the SDK unchanged.

## Lifecycle and bootstrap

Evidence: `src/devbox/{resources,models,conversion}.ts`; generated `src/proto/namespace/private/devbox/devbox_pb.ts`; [client](https://namespace.so/docs/reference/typescript-sdk/client), [management](https://namespace.so/docs/devbox/managing), [images](https://namespace.so/docs/devbox/images).

| Operation | Source constraint |
| --- | --- |
| `devboxes.create` | Activates by default; `start: false` creates stopped. Returned state is not completed checkout/bootstrap. |
| `get` / `refresh` | Fetch current state without explicitly activating. List results have unknown runtime state and no instance ID. |
| `start` | Calls `Activate` with readiness requested, invalidates connections. No separate high-level resume method. |
| `stop` / `delete` | Call `Stop` / `Expire`; delete removes persistent volume too. |
| Blueprint create | Resolves a template, then `CreateFromTemplate`. Cannot combine with direct image/repository/env/size/volume configuration. |
| Image selection | Use `imageName` for registered names such as `builtin:agents`; legacy `image` heuristics interpret punctuation as a reference. |
| Update | Volume cannot shrink; volume, privilege, and network-policy changes apply after restart. `busyTimeoutMs` is not a command deadline. |

- Connection readiness does not prove the repository directory exists. Wire `AgentService.WatchBoot` exists, but no high-level bootstrap wait does. Require an explicit supervisor-ready observation before work.
- Image registration metadata supports `onCreate`, `onStart`, `sessions`, workspace directory, user, and environment. `onStart` maps to wire `onStartup`. Indefinite foreground hook behavior is unverified; a named startup session or idempotent supervisor hook is only a candidate.
- High-level blueprint definitions omit repository, hooks, sessions, and secret references supported elsewhere. Updates replace the whole definition with last-write-wins semantics. Read conversion filters secret-backed environment entries, so read/modify/write can silently delete dashboard settings. Preserve the full wire definition or treat such blueprints as immutable inputs.
- Image optimization streams setup progress and requires final `DONE`; it is not a task-start prerequisite to repeat. A changed image name affects new boxes, not existing ones.

## Execution and uncertain outcomes

Evidence: `src/devbox/connection.ts`, `devbox.ts`, `models.ts`; generated `src/proto/namespace/private/devbox/wire/wire_pb.ts`; [commands](https://namespace.so/docs/reference/typescript-sdk/commands), [exec/logs](https://namespace.so/docs/devbox/exec), [sessions](https://namespace.so/docs/devbox/sessions).

- `exec(argv)` has no shell expansion; `shell(script)` uses a shell without a PTY. Nonzero exits resolve as results. The collector currently reports `signal: null`, drops wire `execId`, and buffers all output even with callbacks. It is unsuitable for unbounded logs or durable invocation identity.
- CLI detached exec returns an ID and survives client disconnect, not box stop. Wire `StartExec`, `StreamExecLogs`, and `ListLogs` exist but lack high-level wrappers. Log streaming has no replay cursor. A missing final result throws `IncompleteResponseError`, not proof the command never ran.
- `terminal.open` creates an SSH shell, not a named persistent Namespace session. Named sessions survive disconnect; connection takes exclusive control. Neither substitutes for Herdr's protocol.
- No high-level execution status, attach, or kill-by-ID API was found. RPC abort does not establish descendant-process termination. Connection acquisition can outlive a caller's cancellation; cancellation is not rollback.
- Connection acquisition has a default 90-second budget. Connection-backed operations share the remaining caller budget across phases; compound get/start helpers do not guarantee one total budget. Gateway retries are bounded exponential backoff without visible jitter; authentication rejection is permanent, with no automatic refresh/retry.
- Create/exec lack idempotency keys. A task-derived name helps reconciliation but does not prove exactly-once creation. Wire leases are pooled-resource reuse, not generic request deduplication. Never replay a lost create or exec response blindly.

## Credentials, repositories, and secrets

Evidence: `src/auth/{token,caching,claims}.ts`, `src/api/interceptors.ts`; [SDK auth](https://namespace.so/docs/reference/typescript-sdk/authentication), [workload access](https://namespace.so/docs/workspaces/access#workload-access), [permissions](https://namespace.so/docs/security/permissions).

- Default loading checks `NSC_TOKEN_FILE`, workload token file, then user configuration. `loadWorkloadToken` does not fall back to user auth, but loads a snapshot, not a file watcher. Successful lazy providers resolve once. Static bearer sources do not renew, even through the cache; session credentials can issue fresh tenant tokens.
- RPC/gateway calls request five minutes of validity, not authorization for an hours-long connection. JWT `extractClaims` is unverified decoding, unsuitable for authenticating callbacks. SSH sets `hostVerifier: () => true`; its trust boundary is the authenticated TLS gateway and per-instance key, not independent host-key pinning.
- Default workload tokens permit any Namespace feature according to docs; fine-grained workload policies are enterprise-scoped. A separate VM is not task-scoped credential isolation. Exact grants, token rotation, and plan availability remain unproven, including the permission mapping for Stop.
- [OIDC federation](https://namespace.so/docs/federation/openid) requires configured issuer trust, with generic onboarding through support. Wire `IssueTenantTokenWithOIDC` exists; the default auth loader does not perform that exchange. Workers does not gain a Namespace identity automatically.
- Wire `IssueIdToken({ audience })` can issue a callback identity from `https://federation.namespaceapis.com`. Signature, issuer, audience, expiry, actual instance claims, and assignment binding need validation. A workspace claim alone cannot authorize arbitrary tasks.
- Workspace GitHub integration and CLI `setup-github` differ. The latter forwards a local user's `gh` token and configures Git. High-level repository input is only a string; lower-level configuration includes ref/disabled. Omission may inherit a workspace repository. Clone success proves neither push/PR permissions nor restricted repository access. [GitHub setup](https://namespace.so/docs/devbox/managing#setting-up-github-cli).
- High-level literal environment maps cannot express `fromSecretId`. A secret ID string is not secret resolution. Avoid plaintext vault dumps as a workaround. [Secret injection](https://namespace.so/docs/architecture/storage/secrets) exposes values to workload processes; [egress header injection](https://namespace.so/docs/security/egress-policy) is a different, DPI-based facility requiring compatibility checks. Domain allowlists cannot isolate repositories on the same GitHub host.

## Lifetime and persistence

- [Idle detection](https://namespace.so/docs/devbox/managing#how-idleness-is-detected) uses active SSH, a recently created session, or any file under `/.namespace/tasks`. [Busy builds and agents can still stop](https://namespace.so/docs/guides/devbox/long-running-tasks). CPU load, old sessions, HTTP activity, and pending promises are not documented keepalives.
- Task markers have no expiry and survive restart. A crash can leave compute billable indefinitely; manual stop still works. Cached SDK SSH connections can also keep a box active until closed. Cleanup needs an owner beyond a shell trap.
- Stop/start preserves files and configuration, not detached processes or an in-memory review callback. Devbox `Stop` is not Compute `SuspendInstance`, which snapshots memory and pairs with `WakeInstance`. Do not manage the backing VM independently by analogy.
- Stopped retention is policy-derived when unset; negative disables cleanup, zero permits immediate eligibility, positive delays eligibility. Actual deletion need not happen immediately. This wire description is more precise than the docs' simplified "deleted when stopped" wording.
- No high-level hard runtime deadline/extend API exists. Compute deadlines are a different lifecycle. Provider-enforced continuous-runtime caps remain unknown.
- Persistent paths are not fully described by the high-level client. Image wire fields include omitted volume/whole-system settings. Do not assume `/tmp`, home, and writable layers have identical retention. Logs disappear on deletion; log caps are unknown.
- [Artifact storage](https://namespace.so/docs/architecture/storage/artifact-storage) requires create, signed PUT, then finalize. Resolve yields a bearer download URL documented for 30 minutes. Only artifact namespace `main` is accepted for creation; it is not a tenant boundary. No expiry means indefinite retention. Finalize retry safety and version-specific readback are untested. Evidence: `src/api/storage/client.ts`, `src/proto/namespace/cloud/storage/v1beta/artifact_pb.ts`.

## Review ingress and QA

- [Devbox URLs](https://namespace.so/docs/devbox/url) require Namespace authentication, permit private/workspace access, and can wake a sleeping box. Access mode applies to all exposed ports. CLI expose/get/list/unexpose exists; high-level TS exposure methods do not. A generated `public` access variant is not documented server support or an expiring bearer link.
- [Compute ingress](https://namespace.so/docs/architecture/networking/ingress) separately documents TLS, `x-nsc-ingress-auth`, and unauthenticated routes. This does not prove authenticated proxying through `devbox.so`, stability across activation, or arbitrary localhost access. Enterprise custom-domain features are plan-dependent.
- Gateway-to-private-ingress and an authenticated devbox outbound relay remain candidates. Streaming, host/path routing, waking/restarting the review process, port reuse, and direct-backend bypass are unresolved. Approval protocol/security evidence is in [Plannotator](plannotator.md).
- [Machine sizes](https://namespace.so/docs/devbox/managing#machine-sizes) describe burst CPU; [resource limits](https://namespace.so/docs/architecture/compute/resource-limits) are aggregate workspace budgets, not task entitlements. Measure combined agents, builds, and browsers.
- [Playwright guidance](https://namespace.so/docs/integrations/playwright) is not evidence for this image's browser sandbox, `/dev/shm`, fonts, codecs, display, or egress. Linux headless screenshots do not require VNC/macOS. `display.screenshot` needs a machine display and may reject on Linux. Source examples and unit tests use mocks or billable resources; none were executed.
