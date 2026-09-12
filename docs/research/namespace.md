# Namespace devboxes and TypeScript SDK

Research date: 2026-09-12. Status: source and documentation review, not an integration validation.

## Recommendation

Namespace is a plausible host for Bridle's task runtime. Use a Linux devbox with a prebuilt Node image, a restartable operator, Herdr, and explicit task records. Do not make a multi-hour task depend on an SDK request, an SSH connection, or a Durable Object's in-memory state.

Four findings block a straightforward "install SDK in the Worker" design:

1. The pinned SDK is `1.1.0`, but the public npm registry returned `latest: 1.0.0` during this review. That published package has generated Devbox protocol files but no high-level `createDevboxClient` export. Resolve distribution before implementation.
2. The SDK's default HTTP/1.1 transport waits for Node's `socket` event, which Workers documents as unsupported. Agent execution additionally requires Node HTTP/2 over a custom WebSocket-backed stream. Workers' `node:http2` is a non-functional stub. `nodejs_compat` does not fix either mismatch.
3. Namespace's documented `devbox.so` URLs require Namespace login and offer `private` or `workspace` access, not public expiring bearer links. A generated `public` field exists, but its presence is not proof that Bridle can use it. Put a Bridle-authenticated review gateway in front, subject to a connectivity spike.
4. Idle shutdown can interrupt a busy build or an agent. CPU activity is not the keepalive signal. Use `/.namespace/tasks` markers while live processes must survive. Files survive ordinary stop/start; detached executions do not.

Recommended first deployment candidate: Cloudflare Worker plus one Durable Object per task; one small trusted Node control adapter if needed; one persistent Namespace Linux devbox per task; external artifact storage. A direct fetch-based lifecycle client could remove the adapter if image bootstrap and authenticated callback delivery work. Neither candidate changes who decides the workflow: the AI operator runs in the devbox with Effect v4 tools, Herdr owns coding-agent terminals, the planner returns approved Markdown without implementing, and humans do final review and merge. Bridle must not merge.

## Evidence and limits

Only `docs/research/namespace.md` is owned by this research. No application code, commits, credential loading, authentication commands, cloud resources, SDK examples, builds, or tests were run. Public documentation and npm metadata/package archives were fetched without credentials. npm archives were inspected as data, not installed or executed. Initial Firecrawl requests were rate-limited; public HTML retrieval was used for the two starting pages, then bounded Firecrawl crawls supplied the linked documentation.

Labels used below:

- **Source** means behavior visible in the pinned client or protocol definitions. Generated request fields and comments are not server implementation evidence.
- **Docs** means a primary provider document says it works. This review did not exercise it.
- **Proposal** means a Bridle integration recommendation, not a settled product decision.
- **Gap** means the evidence does not establish the behavior.

### Pinned source and package

- Upstream: <https://github.com/namespacelabs/typescript-sdk>.
- Subtree: `repos/namespace-sdk/`, read-only.
- Upstream revision: `a72324a20c4c6402960a2fd4ed6382624691b8d9`.
- Squash commit: `5873ae503ff027e5a7a83ec6cab148c70b0cd168`; import merge: `aaa6dbaf1`. The squash message records `git-subtree-split` with the full upstream revision.
- Source permalinks use <https://github.com/namespacelabs/typescript-sdk/tree/a72324a20c4c6402960a2fd4ed6382624691b8d9>.

Unless otherwise stated, source paths below are relative to `repos/namespace-sdk/`. Line ranges refer to that revision. `DB` abbreviates `src/proto/namespace/private/devbox/devbox_pb.ts`; `Wire` abbreviates `src/proto/namespace/private/devbox/wire/wire_pb.ts`; `Compute` abbreviates `src/proto/namespace/cloud/compute/v1beta/compute_pb.ts`.

| Item | Observed value and evidence |
| --- | --- |
| Package | `@namespacelabs/sdk`, source version `1.1.0`; `package.json:1-10` |
| Exports | ESM and CommonJS; root, `/auth`, `/devbox`, `/vnc`, `/api/*`, `/proto`, `/proto/*`; `package.json:10-141` |
| Direct runtime dependencies | `ssh2 ^1.17.0`, `ws ^8.21.1`; `package.json:195-198` |
| Peers | `@bufbuild/protobuf ^2.2.0`, `@connectrpc/connect ^2.0.0`, `@connectrpc/connect-node ^2.0.0`; `package.json:178-182` |
| Lockfile resolution | protobuf `2.11.0`, Connect and connect-node `2.1.1`, ssh2 `1.17.0`, ws `8.21.1`; `package-lock.json:177-185,236-260,922-939,987-1009` |
| Node baseline | No SDK `engines` declaration. Locked connect-node requires Node `>=20`; publishing workflow uses Node 22. Prefer Node 22 for the first spike. Bun is untested here. `package-lock.json:247-260`; `.github/workflows/npm-publish.yaml:14-20` |
| License | SDK metadata and README declare Apache-2.0. No tracked standalone `LICENSE` or `NOTICE` file was found, despite `files` including `LICENSE`. Public 1.0.0 tarball also lacked a license file. Confirm distribution completeness before adoption. `package.json:142-147,168-172`; README license section |
| Dependency licenses | Lockfile declares Connect Apache-2.0, protobuf Apache-2.0 AND BSD-3-Clause, ws MIT. ssh2's lock entry has no license field and includes optional `cpu-features` and `nan`. This is not a complete dependency license audit. |

### Publication mismatch

The unauthenticated metadata request to <https://registry.npmjs.org/@namespacelabs%2fsdk> returned versions `0.1.0`, `0.2.0`, `0.3.0`, `1.0.0-rc.1`, and `1.0.0`, with `latest` set to `1.0.0`. No `1.1.0` entry appeared. Metadata for <https://registry.npmjs.org/@namespacelabs%2fsdk/1.0.0> reports Git head `b0c28cc9d73dd3c37651ff0c5b22b1e843a8fd45` and publication on 2026-06-01.

The published archive <https://registry.npmjs.org/@namespacelabs/sdk/-/sdk-1.0.0.tgz> was inspected. `package/dist/esm/index.js:1-13` exports auth and API modules only. `package.json` has no `/devbox` export. Generated `proto/namespace/private/devbox/` files are present, which must not be confused with the new operational client. Archive integrity returned by npm was `sha512-baAbAIFhwwdzvPsLhytnaI2TcAFJP3ugTuOu0LlaDaRVIfUPirWy+WgTJfo1rtmQwXNiXuHSTuVbsq4Q7fTk5w==`.

This is an observed mismatch between pinned source, live documentation, and the registry response, not a claim about a future release. Recheck it first. Do not import the subtree into Bridle or assume an unversioned `npm install @namespacelabs/sdk` supplies the API described below.

## API map

The high-level entry point is `createDevboxClient(options?)` from `/devbox` or the package root. Options are `tokenSource`, `transport`, `baseUrl`, and `connectionTimeoutMs`. The default Devbox endpoint is `https://private-api.iad.namespaceapis.com`, overridable by `NSC_DEVBOX_ENDPOINT`. This endpoint does not select the machine's location; per-request `site` does, defaulting to `iad`. `client.close()` drops cached connections, not cloud resources. Source: `src/devbox/index.ts:14-73`; [client reference](https://namespace.so/docs/reference/typescript-sdk/client).

### Creation and lifecycle

| Intent | Exact high-level API and wire operation | Important limit |
| --- | --- | --- |
| Create | `client.devboxes.create(input, options?)`; `DevBoxService.Create` | Starts by default through `activate: true`; `start: false` creates stopped. |
| Create from blueprint | `create({ name, blueprint, site?, access?, purpose?, start? })`; `FetchTemplate`, then `CreateFromTemplate` with `templateId` | Cannot also supply image, repository, environment, size, volume, ephemeral, privileged, features, or network policy. |
| Fetch | `client.devboxes.get(idOrName, options?)`; `Fetch({ idOrName, returnActivatedInstance: true })` | Fetches current runtime state without explicitly activating. |
| Refresh handle | `devbox.refresh(options?)`; `Fetch({ id, returnActivatedInstance: true })` | Use this instead of trusting an old snapshot. |
| List | `client.devboxes.list({ cursor?, limit?, orderBy?, ephemeral?, signal?, timeoutMs? })`; `List` | Returns `{ items, nextCursor? }`. Listed state is `unknown`, with no instance ID. `iterate()` follows pages. |
| Start/resume | `devbox.start(options?)` or `client.devboxes.start(ref, options?)`; `Activate({ idOrName, waitForReadiness: true })` | Invalidates old connections. There is no separate high-level `resume()` method. |
| Stop | `devbox.stop(options?)` or `client.devboxes.stop(ref, options?)`; `Stop({ name })` | Invalidates cached connections after RPC success. Ordinary persistent storage remains. |
| Delete | `devbox.delete(options?)` or `client.devboxes.delete(ref, options?)`; `Expire({ name })` | Permanent removal includes associated persistent volume, per docs. |
| Update | `devbox.update({ size?, volumeSizeGB?, busyTimeoutMs?, privileged?, networkPolicy? }, options?)`; `Update` | `busyTimeoutMs` maps to `busyEnsureMinimumDuration`, not a command deadline. |

Source: `src/devbox/resources.ts:54-225`; `src/devbox/models.ts:64-126,266-360`; `DB:3830-3955`. Docs: [managing devboxes](https://namespace.so/docs/devbox/managing).

Direct image creation accepts `name`, `site`, `purpose`, `access`, `start`, `os`, `size`, `volumeSizeGB`, `repository`, literal `environment`, `ephemeral`, `privileged`, `features`, and `networkPolicy`. Use either `image` or `imageName`. Use `imageName: "builtin:agents"` explicitly for that registered built-in name. The legacy `image` string heuristic treats strings containing `/`, `@`, or `:` as image references. Source: `src/devbox/models.ts:64-109`; `src/devbox/resources.ts:61-96,369-392`.

Creation returns a handle whose state is set from `shouldStart`; it does not separately wait for repository checkout or every bootstrap action. A connection-backed operation activates with readiness enabled, but readiness is not evidence that the checkout directory already exists. README's Devbox section explicitly warns about this race. `AgentService.WatchBoot` and boot results exist at the wire level; no high-level bootstrap-wait API is exposed. Source: `src/devbox/resources.ts:99-100`; `src/devbox/connection.ts:433-475`; `Wire:2297-2306`.

Volume resizing cannot shrink, is capped by workspace policy, and applies on next restart. Privileged and network-policy changes also apply on next restart. Source: `DB:3231-3285`. Confirm size-change application timing in the spike rather than assuming a running VM resizes immediately.

### Bootstrap, blueprints, and images

Source exposes three different configuration concepts:

- `client.images.register({ name, ref, description?, metadata? })` calls `WireImage`. `metadata` accepts `workspaceDir`, `shell`, `user`, `privileged`, literal `environment`, `onCreate`, `onStart`, `sessions`, and `includeInPath`.
- `onCreate` and `onStart` entries are `{ command, args? }` or `{ script }`. `onStart` maps to proto `onStartup`. A session entry is `{ name, command, emoji? }`.
- `client.blueprints.create(name, definition)` calls `CreateTemplate`. `definition` accepts `image`, size/site/access, description, environment, volume, ephemeral, features, network policy, and busy timeout. In the high-level type it does not accept repository, hooks, sessions, secret references, or macOS selection. The dashboard's blueprint configuration is richer.

Source: `src/devbox/models.ts:362-443,459-517`; `src/devbox/conversion.ts:206-280`; `src/devbox/resources.ts:231-293`; `DB:1611-1692,2215-2314`.

`blueprints.update()` replaces the definition wholesale with last-write-wins behavior, not compare-and-swap. Worse, the high-level read conversion filters out secret-backed environment entries and does not represent all server fields. Reading a dashboard-managed blueprint and writing `definition` back can remove settings the wrapper cannot represent. Treat managed blueprints as immutable inputs unless the full wire definition is preserved. Source: `src/devbox/models.ts:431-438`; `src/devbox/resources.ts:261-277`; `src/devbox/conversion.ts:247-280`.

Images support `get`, `list`, `iterate`, `inspect`, `optimize`, and `delete`. `optimize(selector, { site?, onProgress?, signal?, timeoutMs? })` defaults to `iad`, streams `preparing`, `starting`, and `baking`, and requires a final `DONE`. This is a minutes-long setup step, not a task-start dependency to repeat. The CLI builds Dockerfiles on remote builders and automatically optimizes the result. Rebuilding a named image affects new devboxes, not existing ones. Source: `src/devbox/resources.ts:287-374`; [custom images](https://namespace.so/docs/devbox/images).

Proposal: bake Node 22, the operator, Herdr dependencies, Plannotator, Git tooling, and selected browser binaries into a versioned image. Use a named startup session or an idempotent startup hook to launch a small supervisor. It should obtain the task assignment, prepare the repository, then report readiness to the task DO. Do not run an infinite foreground operator inside a hook until hook blocking semantics are verified. Task-specific configuration must not require putting credentials into the image. This is a bootstrap candidate, not a verified Herdr/Namespace integration.

### Exec, background work, logs, and attach

| Need | Available interface | Consequence for Bridle |
| --- | --- | --- |
| Structured command | `devbox.exec(argv, { cwd?, env?, stdin?, onStdout?, onStderr?, signal?, timeoutMs? })` | Literal argv, no shell expansion. Uses agent `RunExec`. |
| Shell script | `devbox.shell(script, options?)` with optional `shell` | Uses selected shell or `/bin/sh` with `-lc`; no PTY. |
| Result | `{ exitCode, signal, error?, stdout, stderr }` | Non-zero exits resolve normally. Current collector always sets `signal: null`. |
| Detached command | CLI `devbox exec -d <box> -- <command>` | Returns execution ID and survives CLI disconnect, but not devbox stop. No high-level TS detached method. |
| Wire detached API | `AgentService.StartExec({ command: RunCommand })` → `{ execId }` | Requires a custom agent connection or control adapter; SDK's internal RPC client is private. |
| Re-read/follow logs | CLI `devbox logs <box> <execId>` and `devbox logs list <box> -o json`; wire `StreamExecLogs({ execId })`, `ListLogs({})` | Output replays then follows until completion. No offset/cursor in `StreamExecLogsRequest`. |
| Fresh PTY | `devbox.terminal.open({ columns?, rows?, term?, env?, signal?, timeoutMs? })` | SSH shell, not a named persistent Namespace session. |
| PTY handle | `write`, `resize`, `close`, `onData`, `onExit`, `onError`, `wait` | Closing the transport is not detached-session management. |
| Persistent Namespace session | CLI `devbox session connect <box> --session <name>` | Named session survives disconnection. Connecting takes exclusive control. |
| Wire session management | `CreateTerminalSession({ name, command })`, `ListTerminalSessions`, `AddTerminalSession`, `DeleteTerminalSession` | Present in generated `AgentService`, absent from high-level `terminal.open`. |
| Herdr attach | No Namespace-specific Herdr API verified | Run Herdr in the task devbox and attach through Herdr's own protocol/terminal behavior. Do not replace it with Namespace Sessions by assumption. |

Source: `src/devbox/devbox.ts:71-86,115-120`; `src/devbox/connection.ts:96-107,144-346`; `src/devbox/models.ts:131-178`; `Wire:20-116,173-294,2297-2457`. Docs: [commands](https://namespace.so/docs/reference/typescript-sdk/commands), [CLI exec and logs](https://namespace.so/docs/devbox/exec), [sessions](https://namespace.so/docs/devbox/sessions).

`RunCommand` has `cwd`, `command`, `args`, `additionalEnvironment`, `stdin`, and `runAs`. The high-level builder does not expose `runAs` or secret-backed env/stdin. Relative `cwd` resolves under the workspace; absolute paths pass through. Source: `Wire:42-78,355-398`; `src/devbox/connection.ts:210-232`.

The high-level collector buffers every stdout/stderr chunk even when callbacks are supplied. It also drops the wire `execId` from its result. Do not use it for hours of unbounded logs or as the durable identifier for a tool call. A broken stream without a final result throws `IncompleteResponseError`; it does not imply the remote command never started. Source: `src/devbox/connection.ts:238-265`; `Wire:260-289`.

No high-level `exec.cancel`, `exec.status`, `exec.attach`, kill-by-execution-ID, or resumable log cursor was found. The CLI documentation ties foreground execution to its client session. The SDK passes cancellation to the RPC, but source here does not establish termination of every descendant process after timeout, connection failure, or abort. Test process-group cleanup and reconcile ambiguous outcomes.

## Transport and Cloudflare compatibility

### What actually goes over the network

| Path | Implementation | Runtime requirement |
| --- | --- | --- |
| Devbox lifecycle, blueprints, images | Connect protocol, JSON, HTTP/1.1 to `private-api.iad.namespaceapis.com`; bearer Authorization interceptor | Currently uses `@connectrpc/connect-node`, not fetch. |
| Public Compute/Storage/Vault APIs | Connect HTTP/1.1 JSON to `https://{region}.compute.namespaceapis.com`; IAM/Registry use `https://global.namespaceapis.com` | Node factory by default; descriptors can be used with another transport. |
| Exec/shell agent | `Activate`, then `wss://gate.<ingressDomain>/<encoded-instance-id>/hsvc.unixsocket?name=agent` with `Authorization: Bearer ...`; a Node `Duplex` wraps WebSocket frames; native gRPC HTTP/2 runs over that stream | Node HTTP/2 and custom `createConnection`. `http://devbox-agent` is a synthetic authority, not a publicly callable endpoint. |
| PTY and SFTP | Same gateway with `name=ssh`; `Activate` requests `includeSshCredentials: true`; ssh2 uses returned key and selected user | ssh2, ws, Node streams and SSH protocol. |
| Display | Regional `GetVNCConfig`; VNC over WebSocket with `x-nsc-ingress-auth: Bearer ...` | Separate Node-oriented VNC stack. Not the exec connection. |

Source: `src/devbox/index.ts:56-68`; `src/api/clients.ts:38-68`; `src/devbox/connection.ts:1-77,144-169,433-475,601-656`; `src/devbox/display.ts:28-89`.

SSH uses a bearer-authenticated TLS gateway and a per-instance key as its trust boundary. The ssh2 configuration sets `hostVerifier: () => true`, with 15-second keepalives and three missed responses. This is not independent SSH host-key pinning. Source: `src/devbox/connection.ts:639-652`.

### Can the unmodified SDK actually run in Workers?

Not as a complete operational client on the documented Workers runtime. This conclusion is based on concrete source/runtime mismatches, not just the presence of `node:` imports.

1. **Even default lifecycle HTTP/1.1 has a mismatch.** The locked `@connectrpc/connect-node@2.1.1` archive's `package/dist/esm/node-universal-client.js:98-125`, function `h1Request`, waits for `request.on("socket", ...)` before calling `onRequest`. That callback starts request-body writing and registers the response handler at lines 42-64. Cloudflare's [HTTP compatibility documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/#other-differences-between-node-js-and-workers-implementation-of-node-http) explicitly says the `socket` event and direct socket access are unsupported. HTTP module import success is not sufficient.
2. **Agent exec has a harder mismatch.** `AgentConnection` constructs `createGrpcTransport` with `nodeOptions.createConnection` returning a WebSocket-backed Duplex. connect-node's `package/dist/esm/grpc-transport.js:14-21` explicitly selects HTTP/2. Cloudflare lists `node:http2` under [non-functional stubs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/#non-functional-stub-modules). A compatibility flag can make imports resolve without supplying HTTP/2 sessions.
3. **SSH/SFTP are not proved portable.** The code uses the Node `ws` client with custom handshake headers and ssh2. Cloudflare HTTP documents no Node `upgrade` event. A Workers-native WebSocket tunnel would need a different implementation, not just a changed `baseUrl`.
4. **Custom control transport does not replace connection transport.** `createDevboxClient({ transport })` changes DevBoxService RPCs only. The connection manager still constructs its own agent/SSH/display connections. It also needs a token source separately. Root and `/devbox` imports pull in those modules even if only lifecycle methods are called. Bundle and import behavior require a separate check.

External dependency source was read from <https://registry.npmjs.org/@connectrpc/connect-node/-/connect-node-2.1.1.tgz>, not installed. The above compiled-file paths and line ranges refer to that archive. Namespace's own [SDK overview](https://namespace.so/docs/reference/typescript-sdk) describes Node.js applications, not Workers support. No Workers test or Bun test was found in the inspected SDK tests/examples. No runtime compatibility test was performed here.

Current Cloudflare docs also say compatibility dates at or after `2026-08-04` enable Node compatibility by default. Earlier supported dates require `nodejs_compat`. This changes module availability, not the missing semantics. Pin and record the compatibility date in any spike.

### Direct HTTP subset

A fetch-based control subset is credible because the SDK already sends Connect JSON over HTTP/1.1. Connect unary calls are ordinary JSON POSTs, not native gRPC framing. The [Connect protocol](https://connectrpc.com/docs/protocol/#unary-request) defines paths, headers, error bodies, and protobuf JSON encoding.

Derived wire shape, not executed:

```http
POST https://private-api.iad.namespaceapis.com/namespace.private.devbox.v1beta.DevBoxService/Create
Authorization: Bearer <server-side Namespace credential>
Content-Type: application/json
Connect-Protocol-Version: 1
Connect-Timeout-Ms: 30000

{"name":"bridle-task-<id>","imageName":"<registered-image>","site":"iad","activate":false}
```

Subsequent unary calls can use `Fetch`, `Activate`, `Stop`, and `Expire` at the same service prefix. `Activate` accepts `idOrName` and `waitForReadiness`; `Stop` and `Expire` use `name` in the high-level implementation. `DB:95-260,409-456,648-715,997-1033,3834-3930` and `src/devbox/resources.ts:61-180` establish the request names and mappings.

Prefer protobuf descriptors imported from a normal published package plus a fetch-compatible Connect transport, or a small schema-checked unary HTTP adapter. Do not import auth/client factories into the Worker just to reach descriptors. Use protobuf JSON conversion for durations, timestamps, enum values, bytes, and 64-bit integers rather than generic `JSON.stringify` on SDK objects. `@connectrpc/connect-web` is a possible transport dependency, not something validated in this review.

The `private` namespace in `namespace.private.devbox.v1beta.DevBoxService` deserves an explicit support/stability check with Namespace. The high-level SDK uses it, but that does not establish an independent compatibility promise for handwritten clients. There is no evidence that `AgentService` is exposed as public Connect JSON at that endpoint. Do not POST `RunExec` there by analogy.

Proposal: use the direct subset only for create/start/fetch/stop/delete and perhaps configuration. Let image startup launch the operator, then use Bridle's own authenticated task protocol. If this cannot bootstrap without arbitrary remote exec, put the official Node SDK or documented CLI behind a trusted control adapter. Keep this adapter outside task devboxes so it can create and recover them.

## Authentication, GitHub, secrets, and scope

### Namespace credentials

Source: `src/auth/token.ts:5-20,121-179,218-315`; `src/auth/caching.ts:8-94`; `src/api/interceptors.ts`; [SDK authentication](https://namespace.so/docs/reference/typescript-sdk/authentication).

- `loadDefaults()` checks `NSC_TOKEN_FILE`, then `/var/run/nsc/token.json`, then the local user's `ns/token.json`.
- `loadWorkloadToken()` requires a bearer token and does not fall back to the user. It returns a loaded token, not a file watcher.
- `fromBearerToken(token)` returns the same bearer token. It does not renew it or enforce requested minimum validity.
- Successful lazy providers resolve once. The caching wrapper checks JWT expiration for reuse and single-flights issuance, but a refresh from a static source still returns the same token. Passing `loadWorkloadToken` as a lazy provider does not reread a rotated file on each RPC.
- Session credentials can issue fresh tenant tokens. The file cache checks tenant ID and expiration, requests twice the minimum validity capped at one hour, and writes `token.cache` with mode `0600`.
- RPC and gateway calls request at least five minutes of validity. This is not a promise that a multi-hour gateway connection remains authorized. There is no authentication-failure refresh-and-retry.
- `extractClaims()` parses an unverified JWT payload. It must not authenticate Bridle callbacks or review links. Source: `src/auth/claims.ts:7-30`.

Gap: prove the workload token lifetime, rotation mechanism, permissions, and renewal behavior under an operator that remains alive for hours. Do not rely on README language about automatic refresh for all token types.

### Workload identity is not task isolation

[Workspace access documentation](https://namespace.so/docs/workspaces/access#workload-access) says each compute instance gets an identifiable workload token, and default workload tokens allow access to any Namespace feature. Fine-grained workload policies are described for enterprise customers. A dedicated VM is not evidence that its token cannot access another task's artifacts, secrets, devbox, or image.

[Permission documentation](https://namespace.so/docs/security/permissions) lists resource/action grants, including `devbox` create/activate/fetch/list/update/expire, instance exec/SSH, ingress access, artifacts, and vault objects. It does not list every mapping needed here, such as a separate Devbox Stop grant. Determine actual required grants and plan availability with Namespace rather than inventing permission strings.

Bridle should keep one shared team workspace initially, with explicit workspace ID, credential source, approved repository set, blueprint/image identity, and policy configuration attached to that workspace. Do not use process-global current-user credentials as the future tenant boundary. `access: "workspace"` means Namespace workspace access, not permission to answer a question in a Slack/Linear conversation. HTTP URL access is also a separate setting from devbox resource access. Source: `src/devbox/conversion.ts:67-82`; `DB:1414-1422,3280-3285`.

### Federation in both directions

Docs recommend external OIDC federation before application startup. Generic issuer onboarding currently points to Namespace Support, while the SDK authentication guide describes trust relationships restricting issuer, subject, audience, and grants. Cloudflare Workers do not become a Namespace workload by enabling Node compatibility, and this review found no documented automatic Cloudflare-to-Namespace credential exchange.

The high-level auth loader does not exchange external tokens. The generated IAM API does expose `TokenService.IssueTenantTokenWithOIDC({ tenantId, oidcToken, duration? })`, authenticating with the token in the request body. That makes an HTTP control adapter possible once an accepted issuer is available. Source: `src/proto/namespace/cloud/iam/v1beta/tokens_pb.ts:151-180,718-731`; [OIDC federation](https://namespace.so/docs/federation/openid).

For devbox-to-Bridle calls, Namespace can issue an OIDC identity token for an audience. `TokenService.IssueIdToken({ audience })` returns `idToken`, with issuer `https://federation.namespaceapis.com`. Source: `src/proto/namespace/cloud/iam/v1beta/tokens_pb.ts:22-57,681-702`. Proposal: verify signature, issuer, audience, expiry, and the actual workspace/instance claims at Bridle's callback endpoint, then bind the instance to its persisted task assignment. Exact instance claims and issuance grants require a spike. Workspace identity alone is insufficient to select any task's DO.

If federation is unavailable, a scoped expiring control credential in a server-side secret store is a candidate, not a requirement chosen here. Never return it in a review link or place it in agent instructions.

### GitHub repository authentication

Docs establish two distinct paths:

1. Connect a GitHub organization to the Namespace workspace. Devbox creation can clone a repository through the integration. `create({ repository: "github.com/org/repo" })` passes a repository string to the server.
2. `devbox setup-github <box>` or `--setup_github` forwards the local user's `gh` token, runs `gh auth login`, and configures Git through `gh auth setup-git`. This requires an activated devbox and `gh` on PATH. It is not equivalent to workspace GitHub integration and should not be the automated production bootstrap by default.

Sources: [getting started](https://namespace.so/docs/devbox#getting-started), [GitHub CLI setup](https://namespace.so/docs/devbox/managing#setting-up-github-cli), `src/devbox/resources.ts:87-96`; `Wire:421-447` has setup-credentials and checkout boot operations, but not their server implementation.

The CLI spec supports `repository.url`, `ref`, and `disabled`; the high-level TS input accepts only a string. The lower-level `VersionControlSpec` is richer. Source: `DB:2159-2209`; [repository spec](https://namespace.so/docs/devbox/managing#repository). Omission can inherit a workspace default, so "no repository field" is not necessarily "no checkout".

Gaps: exact installed GitHub App permissions; clone versus push/PR rights; bot versus human attribution; token renewal; submodules/LFS; cross-organization repositories; multiple accessible repositories in one task; preventing access to non-approved repositories. A successful default-repository clone does not prove these. Enforce Bridle's no-merge rule independently of available GitHub credentials. Use least-privilege GitHub permissions as an additional control where possible.

### Secrets

[Secrets docs](https://namespace.so/docs/architecture/storage/secrets) describe encryption at rest, access audit logs, versioned objects, immutable labels, and optional revealability. Secrets are explicitly requested and injected into container environment at creation time. They do not appear by default.

The CLI spec and dashboard blueprint support `env: [{ name, from_secret_id }]`. Generated `BlueprintSpec_EnvVar` also supports `fromSecretId`. The high-level SDK's `Record<string, string>` environment map does not. Passing a secret ID as a literal environment value will not invoke vault resolution. Source: `DB:2341-2356`; `src/devbox/models.ts:101,386,399`; `src/devbox/resources.ts:88`; `src/devbox/conversion.ts:223,240,274`.

Options to investigate: dashboard-managed immutable blueprint with secret references; a full-schema control adapter; or authenticated runtime retrieval with restricted grants. Do not work around the missing type by reading all vault values into the DO and serializing plaintext create requests.

[Egress policies](https://namespace.so/docs/security/egress-policy) can inject secret-backed HTTP headers outside the workload, so the workload never receives the secret value. This requires deep packet inspection and a reusable policy selected by the blueprint. It is distinct from the SDK's simple `{ allowedDomains, advisory? }` policy. It may reduce credential exposure to coding agents, but needs tests for model APIs, streaming, certificate trust, and browser traffic. Environment injection itself does not hide credentials from processes in the devbox.

## Lifetime, idle shutdown, and human waits

There are four clocks, not one:

| Clock | Evidence | Bridle consequence |
| --- | --- | --- |
| SDK operation timeout | Optional `timeoutMs`; connection acquisition defaults to 90 seconds | Not a VM lifetime or a durable tool timeout. |
| Devbox idle timeout | Docs list 15m, 30m, 1h, 4h, 8h; TS `busyTimeoutMs` maps to agent busy minimum | A wait longer than this may stop the devbox unless explicitly active. Confirm mapping and workspace caps. |
| Ephemeral stopped retention | `ephemeral: { stoppedRetentionMs }`; policy-derived expiry after stopping | Not an active-runtime budget; cannot protect live work from stopping. |
| Compute instance deadline | Low-level create/extend API, policy-capped | Different product lifecycle. Do not manage a Devbox's backing VM independently without support guidance. |

### What prevents idle shutdown

The [management docs](https://namespace.so/docs/devbox/managing#how-idleness-is-detected) and [long-running tasks guide](https://namespace.so/docs/guides/devbox/long-running-tasks) name these activity signals:

- An active SSH connection, including one held by an IDE.
- A session created within the last 15 minutes.
- Any file under `/.namespace/tasks`.

The guide explicitly says a long build or coding agent may stop even while working, whether started with `devbox exec` or a session. It measures connections and sessions rather than load. Do not assume HTTP/gRPC activity, an old session, a running dev server, or a waiting operator promise counts as activity.

Task markers have no expiry and survive restart. Manual stop still works. A crashed operator can leave a devbox active indefinitely. Proposal: a supervisor owns one marker per active Bridle task and persists enough state to clean it up after failure. An external reconciler checks whether continued compute use is justified. A shell trap is useful but does not cover SIGKILL, VM failure, or lost ownership. SDK SFTP/PTY use also establishes cached SSH connections, which may keep a box active until `client.close()` or connection loss.

### Pause does not establish process continuity

Docs promise files and configuration across ordinary stop/start and retained execution output across pause/resume. Detached exec explicitly ends when the devbox stops. Session documentation promises disconnection survival, not a VM-memory checkpoint guarantee. Some cross-links describe sessions surviving restarts, but that does not establish preservation of live process state.

The underlying Compute API has a different operation: `SuspendInstance` snapshots RAM and disks without restarting; `WakeInstance` is its counterpart. The Devbox high-level `stop()` calls `DevBoxService.Stop`, not `ComputeService.SuspendInstance`. Treat these as different APIs. Source: `src/devbox/resources.ts:152-163`; `Compute:4467-4499`.

Human waiting has two candidate implementations, still a product/engineering decision:

- Keep the task marker while the operator or Plannotator needs its live process. Simple continuity, but consumes compute throughout the wait.
- Persist pending question/review state and artifacts, release activity, and allow stopping. A review gateway receives the answer, activates the devbox, and lets the restarted operator reconcile the approved plan. This needs explicit restartable review state and must not rely on the planner's in-memory callback.

Namespace's authenticated `devbox.so` URL can wake a sleeping box. It cannot by itself preserve a Plannotator process or return an approved plan to a dead operator. This review did not inspect Plannotator or Herdr internals; their recovery behavior remains an integration dependency.

### Ephemeral ambiguity and hard lifetime

`DB:1584-1602` documents `stoppedRetentionDuration` precisely: unset inherits policy, negative disables cleanup, zero makes it eligible immediately after stopping, positive delays eligibility. Expiry is not immediate when the duration elapses. The SDK forwards this duration and its tour uses ten minutes to survive stop/start cycles. Source: `src/devbox/resources.ts:394-401`; `examples/devbox/tour.ts:74-86`.

This is more nuanced than the [blueprint](https://namespace.so/docs/devbox/blueprint#ephemeral) and managing pages' simplified "deleted when stopped, starts fresh" wording. Do not choose ephemeral devboxes for retained task state until behavior under the actual workspace policy is tested. Persistent devboxes with explicit cleanup are the safer initial candidate.

No active hard-expiration field or `extend()` method exists in the high-level Devbox input/handle. Low-level `ComputeService.CreateInstance` accepts `deadline`; expiry sends SIGTERM before destruction and policy can shorten the requested deadline. `ExtendInstance({ instanceId, extendBy?, ensureMinimum?, newDeadline? })` returns the new deadline. `createInstance` is nonblocking; readiness is `waitInstance` or `waitInstanceSync`. Source: `Compute:70-85,2152-2220,4313-4416`; `examples/compute/create-macos-instance.ts:7-25`. These are not a verified way to extend or cap a managed Devbox. Ask Namespace about maximum continuous Devbox runtime and provider-enforced caps. Meanwhile Bridle needs an external overdue-task policy, without silently deciding its duration.

## Exposed ports and Plannotator review links

### Documented devbox URLs

[Shareable URL docs](https://namespace.so/docs/devbox/url) and [CLI reference](https://namespace.so/docs/reference/devbox-cli/url) establish:

- `devbox url expose <box> --port 3000 --name web [-o json]` exposes HTTP through a URL such as `https://<devbox-id>-p3000.devbox.so/`.
- `get`, `list`, `unexpose`, and `access --mode private|workspace` manage it. Repeating matching exposure returns it; removing an absent exposure is ignored.
- The access mode applies to all exposed ports on that devbox, not one port at a time.
- Namespace authentication is required. Opening the URL wakes a sleeping devbox.
- `boxctl url` supports the corresponding operations inside the devbox without selecting a devbox name.
- Local `devbox port-forward` is a separate CLI-held tunnel, not a public link.

The public high-level TS client has no port-exposure or HTTP-access methods. `DB:26-89` defines owner, tenant, and empty public access variants; `UpdateRequest.httpAccessMode` appears at `DB:3280-3285`. The public CLI docs only accept private/workspace. Treat `public: {}` as an unverified server capability, not an implementation plan. Neither this schema nor the CLI exposes a task-scoped expiring review bearer token.

URL spelling and a random-looking hostname do not establish a cryptographic bearer capability. Do not derive authorization from devbox name or hostname. Stability across restart, port-remap behavior, WebSocket/SSE support, proxy timeouts, request-body limits, binding to loopback versus all interfaces, and effect of an active review connection on idleness need tests.

### Lower-level ingress is different

[Compute ingress docs](https://namespace.so/docs/architecture/networking/ingress) document managed TLS, programmatic `x-nsc-ingress-auth: Bearer <ingress-token>`, optional unauthenticated HTTP routes, and enterprise-only custom domains/authentication providers.

`compute.createIngress({ instanceId, ingresses: [{ name, exportedPortBackend, httpMatchRule, wildcard }] })` returns `allocatedIngresses`; `listIngresses({ instanceId })` lists them. `HttpMatchRule.doesNotRequireAuth` allows unauthenticated matching requests. Source: `Compute:2420-2467,3167-3269,4499-4520`.

This proves general Compute supports public HTTP ingress. It does not prove that creating an ingress on a managed Devbox's backing instance yields a stable `devbox.so` URL, survives its next activation, or has access to arbitrary localhost ports. Do not substitute it without a spike and support confirmation.

### Review gateway proposal

Expose a Bridle-controlled public review route with an unguessable, task-scoped, expiring capability. Validate the capability before activating a box, proxying a request, or accepting a decision. Keep Namespace credentials server-side. Restrict proxy destinations to the assigned task and review service, not arbitrary URLs or ports.

Two transport candidates:

1. Gateway proxies to an authenticated Namespace service using a server-side ingress token, if `devbox.so` accepts that flow. General ingress documentation alone does not prove this.
2. Devbox supervisor opens an authenticated outbound connection to Bridle or a trusted adapter. The gateway sends review traffic over it. Reconnect, backpressure, request multiplexing, and any Plannotator WebSocket/SSE behavior must be verified.

Persist the plan, review version, task association, expiry, and accepted decision outside process memory. Reject cross-task, expired, replayed, or stale-plan decisions; define whether an accepted capability is consumed or remains readable. These are required integration/security properties, not a decision about reviewer identity beyond Bridle's existing conversation-access and bearer-link prototype constraints. Do not expose Herdr control or the whole operator API through the review URL.

## Persistence and artifacts

Ordinary Devbox stop preserves persistent storage; deletion removes it. The SDK exposes `workspaceDir`, `defaultDir`, and volume size, and remote filesystem operations through SFTP. It does not expose a complete persistent-mount manifest. The generated image spec has volume and `wholeSystemPersistency` settings that the high-level image metadata type omits. Do not assume `/tmp`, every installed package, every home directory, or a container writable layer has the same durability. Source: `src/devbox/models.ts:34-62,243-264`; `src/devbox/devbox.ts:145-274`; `DB:2261-2282`; [lifecycle docs](https://namespace.so/docs/devbox/managing#starting--stopping).

Logs retained by the agent survive pause/resume but disappear on deletion, per [exec docs](https://namespace.so/docs/devbox/exec#reading-command-logs). Retained log size caps and truncation policy are not established. Export approved plans, findings, review outcomes, test evidence, patches/commit references, and operator checkpoints before cleanup. A successful SFTP download only persists data to the caller's filesystem; it does not create an independent cloud artifact.

Namespace [artifact storage](https://namespace.so/docs/architecture/storage/artifact-storage) has an explicit publication sequence:

1. `createStorageClient({ region, tokenSource }).artifacts.createArtifact({ path, namespace: "main", expiresAt?, labels?, createNewVersionIfExists? })` returns `signedUploadUrl` and `uploadId`.
2. HTTP PUT bytes to the signed upload URL.
3. `artifacts.finalizeArtifact({ uploadId, addLabels? })` commits the artifact.
4. `artifacts.resolveArtifact({ path, namespace: "main", metadataOnly?, includeExpired? })` returns metadata and `signedDownloadUrl`, valid for 30 minutes without separate auth.

Source: `src/api/storage/client.ts:13-42`; `src/proto/namespace/cloud/storage/v1beta/artifact_pb.ts:24-245,646-684`. The source says only the `main` artifact namespace is accepted for creation; don't use that field as a future tenant-isolation mechanism. Use workspace scope and task-specific paths. With no expiration, the source says artifacts never expire. Set retention intentionally and record the returned metadata. Finalize retry/idempotency and version-specific readback need validation.

Namespace artifacts or another object store could hold Bridle evidence. That choice is open. Signed artifact URLs are temporary download capabilities, not interactive Plannotator review sessions. Keep task status, artifact identity, checksums, and decisions independent of those temporary URLs.

## Timeouts, retries, and duplicate effects

Source: `src/devbox/connection.ts:189-202,395-431,526-533,572-596,702-706,744-780`; `src/devbox/resources.ts:131-225,264-277`; [errors reference](https://namespace.so/docs/reference/typescript-sdk/errors).

- Connection acquisition defaults to 90 seconds. Caller `timeoutMs` on a connection-backed operation creates one remaining budget through activation, connection, and work. It is not reset per phase.
- Shared acquisition has its own controller/budget. A caller timing out while waiting does not necessarily cancel the shared connection attempt. An already-aborted caller can reject while an activation attempt has already been created. Do not treat cancellation as rollback.
- Compound resource helpers such as `start(ref)` call get then start with the same options rather than a newly computed shared deadline. Blueprint create resolves a blueprint first. Budget the whole control action externally if required.
- Gateway connection retries use exponential backoff from 500ms to 5s until the deadline. No jitter is visible. HTTP 401/403 and authentication/key errors are permanent. There is no automatic credential refresh after authentication rejection.
- There is no general application RPC retry policy or safe command replay in the high-level client. A connection may be rebuilt on a later call, but the previous command's outcome remains separate.
- `DevboxTimeoutError`, `DevboxGatewayError`, `IncompleteResponseError`, `ImageOptimizationError`, and `DevboxDisplayUnavailableError` are SDK errors. API errors use Connect codes. Non-zero command exit is a result, not an exception. Abort is not a DevboxError subclass.
- No idempotency key appears in high-level create/exec input or `CreateRequest`/`StartExecRequest`. A unique task-derived name is useful for reconciliation, not proof that a retried Create has exactly-once effects.
- Proto `AcquireLease({ tag, create })` and `ReleaseLease({ idOrName?, leaseId? })` support pooled reuse, returning a lease ID and created/reused outcome. This is not exposed by the high-level client and should not be treated as generic request idempotency. Source: `DB:1127-1237`.

Proposal: the DO persists intent before requesting create/start/stop; the adapter and operator accept operation IDs and report acknowledgments/results. Reconcile a timed-out create by task assignment and stored identifiers before creating another resource. Retry read operations under a bounded policy. For side effects, first determine whether the original operation ran. Use application-level durable deduplication for task messages and review decisions. Do not retry `RunExec` blindly.

Multi-hour tool calls should become persisted operations with eventual completion messages. The operator may wait in Node, but task truth must outlive that process. Cloudflare [DO lifecycle docs](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) explicitly allow eviction/restart and provide no reliable shutdown hook. Outstanding fetches, timers, and outbound connections also prevent hibernation. A multi-hour awaited SDK request in the DO is the wrong durability mechanism even if its transport could run.

## Compute sizing and browser QA

| Platform | Source/documented sizes | Caveat |
| --- | --- | --- |
| Linux AMD64 | s: 4 vCPU/8 GiB; m: 8/16; l: 16/32; xl: 32/64 | Management docs call CPU counts burst capacity; workspace policy can restrict sizes. Do not turn overview language about dedicated resources into a sustained CPU guarantee. |
| macOS ARM64 | m: 6 vCPU/14 GiB; l: 12/28; default m | High-level direct create supports it, but no Linux container image may be supplied with `os: "macos"`. macOS capacity must be available. |

Source: `src/devbox/conversion.ts:35-56,94-110`; `src/devbox/models.ts:10-20,87-109`; [machine sizes](https://namespace.so/docs/devbox/managing#machine-sizes). The overview's "Linux AMD64" platform statement is incomplete relative to the pinned source and dashboard blueprint documentation, which support macOS. A declared `architecture: string` in output types is not a guarantee of arbitrary selectable Devbox architecture.

[Resource limits](https://namespace.so/docs/architecture/compute/resource-limits) lists aggregate platform concurrency budgets. At retrieval, Team Linux is 64 vCPU/128 GB and Team macOS 24 vCPU/56 GB, not a per-task entitlement. Contract and workspace policy are authoritative. The API documents structured resource/usage/platform-denied errors. Count all task devboxes, parallel agents, and QA processes against the actual available capacity; no tested capacity/queueing behavior is claimed here.

Linux Devboxes document `/dev/kvm` for nested virtualization without an extra flag, accessible to non-root users, including custom images. Android emulator acceleration needs Linux AMD64. macOS does not offer nested virtualization. Source: [managing devboxes](https://namespace.so/docs/devbox/managing#nested-virtualization).

For web QA, preinstall matching Playwright/browser/system dependency versions and run the app plus tests inside the devbox. Namespace's [Playwright guide](https://namespace.so/docs/integrations/playwright) validates the general compute/runner use case, not Bridle's particular Devbox image or Chromium sandbox settings. No ban on browser QA was found, but `/dev/shm`, sandbox/user namespace permissions, installed fonts, video codecs, headed display/Xvfb, GPU/WebGL, and browser-download egress remain untested.

`devbox.display.screenshot()` and `.click()` use VNC for machines with a display, documented as macOS. Linux without a display rejects with `DevboxDisplayUnavailableError`; this does not prevent headless Playwright screenshots. Source: `src/devbox/models.ts:190-207`; `src/devbox/display.ts:42-89`. Avoid requiring macOS just to capture a web screenshot.

Inline egress allowlists support wildcard subdomains; Namespace infrastructure domains remain allowed per CLI docs. The high-level policy defaults `advisory` to false. Build an explicit list for GitHub, package/browser registries, model providers, Bridle callbacks, artifact uploads, and any QA targets. Advisory mode observes without blocking. A domain allowlist does not distinguish an authorized repository from another repository on the same GitHub host. Source: `src/devbox/conversion.ts:133-146`; [network spec](https://namespace.so/docs/devbox/managing#network-policy); [egress policies](https://namespace.so/docs/security/egress-policy).

## Inspected examples and tests

These are source inspections, not successful executions:

| File | What it covers | What it does not prove |
| --- | --- | --- |
| `examples/devbox/tour.ts:27-247` | Image/blueprint create, exec, files, PTY, stop/start, cleanup | Uses actual billable resources if run. No Worker runtime, multi-hour recovery, or review link. |
| `examples/compute/create-macos-instance.ts:4-35` | Low-level macOS creation, 30-minute deadline, synchronous readiness and command | Leaves instance to deadline/manual cleanup. Not the Devbox product lifecycle. |
| `test/devbox.unit.test.ts:32-162` | Conversion, shapes, defaults, image-name validation with fake RPC | Backend defaults, permissions, actual image boot. |
| `test/devbox.unit.test.ts:164-276` | Deadline arithmetic, in-flight invalidation, cached/lazy token sources | Actual token rotation/renewal, network timeout behavior. |
| `test/devbox.unit.test.ts:278-348` | Fake SFTP cache and terminal close event | Real disconnect behavior or persistent attach. |
| `test/devbox.unit.test.ts:350-450` | Structured command serialization, chunk collection, missing result, separate SSH/agent caches | Remote kill semantics, log retention limits, interrupted command recovery. |
| `src/devbox/display.ts:28-148` | VNC endpoint resolution and error translation inspected | Browser QA or actual display access. |

The example's comment that `update()` allows a backend-resolved arbitrary size conflicts with `toProtoShape()` and its unit test, which resolve updates client-side. Use the implementation, not that comment. Source: `examples/devbox/tour.ts:204-210`; `src/devbox/conversion.ts:94-110`; `test/devbox.unit.test.ts:78-81`.

## Go/no-go spikes

All spikes below are proposed future work. Credentialed or cloud-resource steps require separate approval. Each should produce a checked-in result with exact package versions, compatibility date, image digest, workspace policy, observed timings, and failures, without credentials.

| Spike | Method | Go criterion / no-go consequence |
| --- | --- | --- |
| 1. Published dependency | Requery npm, inspect archive exports/license, import the exact published version in a disposable Node project | Official installable version matches required Devbox API. Otherwise wait for a release or use a supported control adapter/CLI; do not runtime-import subtree code. |
| 2. Worker control transport | Local workerd test first, no credentials: compare connect-node HTTP/1.1 against a local mock and a fetch-based descriptor client. Then approved live create/fetch/activate/stop/delete | The fetch subset produces equivalent typed results/errors with no Node socket/HTTP2 requirement. Default SDK is not acceptable based on bundle success alone. |
| 3. Bootstrap | Prebuilt image, stopped create, activate, wait for explicit operator-ready acknowledgment; repeat after stop/start and forced operator exit | Exactly one supervisor/operator assignment, completed checkout, working Node and Herdr dependencies, no foreground SDK request required for lifetime. Failure means keep a Node bootstrap adapter. |
| 4. Hours-long work and idle | Detached work plus Herdr terminal; disconnect all external clients; cross idle and token-expiry boundaries with and without markers; restart supervisor | Work survives expected disconnects with marker; cleanup removes marker; failures become recoverable records. If not, no unattended Bridle task runtime. |
| 5. Stop/recovery | Stop during active tool and human review; resume; check process IDs, files, logs, approved-plan delivery, task markers | Explicitly distinguish terminated work from resumable state. No duplicate tool/review effects. If review cannot restart, retain compute during review until that gap is fixed. |
| 6. GitHub and least privilege | Test approved/private repo clone, ref, push/PR path, submodule/LFS if required, second approved repo, denied unapproved repo; verify workload token cannot cross intended boundaries | Required access works with acceptable blast radius and enforceable no-merge behavior. Need policy/plan changes if default workload token is too broad. |
| 7. Public review link | Anonymous browser without Namespace account; correct, wrong-task, expired, revoked, and stale-plan links; all Plannotator assets/POSTs/streams; sleeping devbox; direct-origin bypass attempts | Only valid task-scoped capability reaches review and accepted decision is durable. If direct Namespace ingress cannot do this, Bridle gateway/outbound relay is mandatory. |
| 8. Artifact durability | Write to workspace/home/tmp, stop/start, export artifact via create/PUT/finalize, delete devbox, download external artifact | Required evidence remains accessible after deletion; exact persistent paths and retention are recorded. No reliance on cache volumes as the sole record. |
| 9. QA/resource limits | Representative build plus agents plus headless browsers under chosen size, privilege, and egress policy; capture memory/OOM and output growth | Browser QA works without unacceptable privilege or capacity demands. Adjust image/size/concurrency from measurements, not core-count claims. |
| 10. Duplicate/failure delivery | Drop create/start/exec responses, retry DO messages and callbacks, restart adapter/DO, expire credentials | No duplicate task box or tool side effects; ambiguous outcomes reconcile by persisted operation IDs. Otherwise do not enable autonomous retries. |

## Minimal deployment candidates and open decisions

Candidate A, fewer services if spikes 1-3 pass:

```text
Slack / Linear / CLI
        -> Cloudflare Worker -> task Durable Object
                                 | short Connect JSON lifecycle calls
                                 v
                           Namespace devbox
                           supervisor + Node operator + Effect v4 tools
                           Herdr + coding-agent processes + QA
                           Plannotator during review
                                 |
                                 +-> authenticated callbacks / reconnectable task channel
                                 +-> external artifacts

Human -> Bridle review capability URL -> validated review gateway -> review service
```

Candidate B adds a small trusted Node adapter between the DO and Namespace. It uses the published SDK or documented CLI for create/bootstrap/connection-dependent work and optionally provides the review proxy. It must accept persisted operation IDs and survive retries; its own memory is not the task record. This is the lower-risk compatibility path while direct HTTP/bootstrap gaps remain.

Use one configured Namespace workspace initially. Keep workspace credentials, repository access, image/blueprint references, and egress policy explicit so a later tenant cannot inherit another workspace's configuration. Separate provisioner credentials from credentials exposed inside coding-agent processes. Persist task assignment and operation state in the DO, runtime checkpoints in known persistent paths, and findings/decisions/artifacts outside agent session memory.

Still open: provider-enforced maximum task runtime; whether human review keeps compute running; acceptable workload-token blast radius and required Namespace plan; artifact backend and retention; final gateway transport; release/stability guarantees for private Devbox RPCs; browser QA privilege policy; exact GitHub identity and permissions. These should be answered by product decisions and the spikes, not filled in by SDK defaults.
