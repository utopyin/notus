# Herdr and Plannotator execution integrations

## Scope and conclusion

This is source research, not an implementation plan approved for execution. Only the three pinned subtrees were investigated. No packages were installed, agents launched, tests executed, public endpoints exposed, or upstream files changed. The schema comparison below was executed locally with Python.

Labels used throughout:

- **Verified** means the pinned source or tests establish the behavior. A test citation means its assertions were read, not that this investigation ran it.
- **Adaptation** means a recommendation for Bridle, not an upstream capability or a settled product decision.
- **Untested** means an integration assumption that needs a compatibility spike.

The integrations are usable candidates, but neither supplies Bridle's complete execution contract.

1. Herdr owns real terminals. Its SDK can create panes, launch agents, submit prompts, wait, and read output. It does not produce a durable, typed agent-result artifact or prove semantic task completion.
2. SDK and Herdr both use protocol 22. Their pinned API schema JSON values are identical. The SDK's launch method does **not** include the CLI's readiness loop.
3. Prefer the direct Plannotator strict annotate gate for the first prototype. It distinguishes approval, feedback, dismissal, and execution errors without instructing an agent to implement.
4. A public Plannotator port is not an authenticated approval service. Bridle must supply the task-scoped expiring bearer boundary and prevent direct access to the backend.
5. Native integrations need separate evaluation. Claude approval permits `ExitPlanMode`; Pi defaults to implementation and has a headless auto-approval path even in external execution mode.

Bridle's existing product constraints remain unchanged. The AI operator chooses next steps. Effect tools execute and wait. One task Durable Object records status and routes structured messages to the originating conversation; it does not choose the workflow. Planning asks questions and obtains explicit approval, then returns approved Markdown without implementing. Subsequent implementation, specialist reviews, regression review, architecture review, QA, and fixes have no routine human checkpoints. Humans perform final code review and merge; Bridle must not merge. Conversation participants may answer questions. Prototype approval links are unguessable, task-scoped, expiring bearer links.

## Pins, packages, and runtime compatibility

The revisions below come from Bridle's `git-subtree-split` commit metadata. Branch names describe the requested upstream source, not independently checked-out branches inside the subtrees. Shortened source citations are relative to the repository or file named in that discussion.

| Local subtree | Upstream branch and pinned revision | Package/runtime evidence |
| --- | --- | --- |
| `repos/herdr` | `master`, `a5d5f6f654a32b27b2bd4dd8edd82f6795359269` | `Cargo.toml:1-19` declares Herdr `0.9.0`, Apache-2.0; `rust-toolchain.toml:1-3` pins Rust `1.96.1`; `src/protocol/wire.rs:20` declares protocol `22`. |
| `repos/herdr-ts-sdk` | `main`, `77abbf81ac35407bc5138a8f4fe19f0833af4402` | `repos/herdr-ts-sdk/package.json:1-75` declares `@herdr/sdk` `0.9.0`, MIT, ESM, Node `>=20`, protocol `22`, and an expected Herdr revision of `b99002ac99b09e00b4ca692436cb15a6b0d676f1`. |
| `repos/plannotator` | `main`, `0f2bd6051c66d26f2d776a2a521d856627b3316c` | `repos/plannotator/package.json:1-55` declares `0.27.14`, a private monorepo, and `MIT OR Apache-2.0`. `LICENSE-MIT` and `LICENSE-APACHE` contain the license texts. |

Upstream source URLs:

- <https://github.com/herdrdev/herdr/tree/a5d5f6f654a32b27b2bd4dd8edd82f6795359269>
- <https://github.com/dmmulroy/herdr-ts-sdk/tree/77abbf81ac35407bc5138a8f4fe19f0833af4402>
- <https://github.com/backnotprop/plannotator/tree/0f2bd6051c66d26f2d776a2a521d856627b3316c>

### Herdr SDK compatibility

Verified by parsing and recursively comparing:

- `repos/herdr/docs/next/api/herdr-api.schema.json`
- `repos/herdr-ts-sdk/schema/herdr-api.schema.json`

Both contain `protocol: 22` and `schema_version: 1`. Their parsed JSON values are equal. File bytes differ, so byte hashes differ:

| File | SHA-256 |
| --- | --- |
| Herdr schema | `5fb46b13fdaf39c88cf699b9806685868c7ee6b0142523d84391b1606416dc0a` |
| SDK schema | `fafc9d816748558bdcb934c96167ef5bab792c55f333d0c98d9ba5a8505a38cd` |

This removes an obvious wire-schema mismatch. It does not establish equal runtime behavior between the SDK's expected Herdr commit and Bridle's pin.

`repos/herdr-ts-sdk/src/herdr-transport.ts:361-410`, `compatibilityCache`, pings before ordinary requests, rejects other protocols, and caches successful compatibility indefinitely within that transport. Failures have zero cache TTL. `HerdrUnsupportedProtocol` is not a warning to bypass. Adaptation: reconstruct the SDK Layer or explicitly re-ping after endpoint replacement; do not assume the cached check certifies a restarted server forever.

`repos/herdr-ts-sdk/package.json:48-75` has **dependencies**, not peer dependencies, on `effect` and `@effect/platform-node-shared`, both exactly `4.0.0-beta.105`. It has no `peerDependencies` section. Bridle must use Effect v4 and check whether its selected prerelease can coexist with this exact dependency. The primary Effect subtree is `4.0.0-rc.115`, not the SDK's beta pin. Do not substitute Effect v3 examples. No Effect implementation is proposed here. The public entrypoint really exports the services and schemas discussed below, `src/index.ts:10-48`.

The SDK README says this baseline is unreleased and not published to npm, `repos/herdr-ts-sdk/README.md:26-47`. That is a source claim, not an npm registry check. Adaptation: obtain a separately built, pinned package tarball or release dependency. Do not import application code from `repos/`, and do not run its build in the read-only subtree: `build` regenerates wire files before packing, `repos/herdr-ts-sdk/package.json:27-32`.

Runtime placement matters. Herdr requires a host with PTYs, shells, agent executables, filesystem state, and a local socket. The SDK targets Node and local sockets, not a Cloudflare Durable Object. Run this execution side in the Namespace dev box. The Unix API socket uses mode `0600`, `repos/herdr/src/api/server.rs:27-29,132-143`; this is a same-user boundary, not isolation between agents sharing that user. Never expose it through plan-review ingress.

### Plannotator packages and runtime

Verified:

- The direct CLI/server uses Bun APIs including `Bun.serve`, `Bun.file`, and `Bun.sleep`. The standalone binary bundles that runtime; source execution/build needs Bun and built UI assets. See `repos/plannotator/packages/server/annotate.ts:681-689`, `apps/hook/server/index.ts:1445-1452`, and the README's Development/Build sections.
- `repos/plannotator/apps/pi-extension/package.json:67-77` declares the peer `@earendil-works/pi-coding-agent >=0.79.1`. Do not infer compatibility from the older package namespace or a generic "Pi supported" statement.
- `repos/plannotator/apps/opencode-plugin/package.json:25-54` provides different entrypoints for OpenCode 1 and 2, develops against `@opencode-ai/plugin` `0.0.0-next-16775`, and declares Bun `>=1.0.0`. It does not declare an OpenCode peer range. Its broad Bun floor is not evidence that every current dependency works on Bun 1.0.
- `apps/opencode-plugin/README.md:43-49` calls OpenCode 2 support experimental and documents capability-dependent agent switching, URL delivery, and missing immediate abort support. Pin the actual host version if choosing this path.
- `SECURITY.md:3-12` supports only the latest released version for security fixes. Pinning needs an update/revalidation policy, not indefinite trust in this snapshot.

Herdr is Apache-2.0, the SDK is MIT, and Plannotator allows either MIT or Apache-2.0. Preserve the applicable notices when distributing packages/binaries. This is a top-level license check, not a transitive dependency or binary SBOM audit.

## Herdr control model

### Containers and identity

Verified model: session → workspaces → tabs → panes, with a recognized agent running inside a pane. A session is a separate server/socket/persistence namespace. A workspace groups project terminals; a tab contains a split layout; a pane attaches to a terminal process. Creating a workspace creates its first tab and root pane. Creating a tab creates its root pane. `agent.start` requires an existing available shell pane and never creates topology.

Evidence:

- `repos/herdr/docs/preview/website/src/content/docs/concepts.mdx:6-87`, Workspace, Tab, Pane, Agent, Session, Client and server.
- `repos/herdr/docs/next/website/src/content/docs/agent-automation.mdx:8-48`, layout creation, identities, and launch requirements.
- `repos/herdr/src/app/agents.rs:145-231`, `start_agent`, resolves the supplied pane, checks the shell foreground, encodes the command, and submits it.

A Herdr workspace is not Bridle's team credential/configuration workspace. Adaptation: one Herdr task workspace, with one pane per implementer or reviewer session, is a useful layout convention. It does not supply tenant isolation. Keep credentials/configuration separately scoped for later multi-tenancy.

Use returned identifiers. Agent names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents in that server. A name is an alias for a live agent, not a durable conversation identifier. Moving a pane across workspaces changes its public pane ID; in-flight waits can fail with `agent_not_running`. Preserve `terminalId`, current `paneId`, agent kind, and native session reference in the Bridle record. See `src/app/agents.rs:15-20,94-143` and `docs/next/website/src/content/docs/agent-automation.mdx:25-38`.

### Exact SDK operations

These are method/input shapes, not a compiled Bridle implementation. Optional transport options are the final argument. SDK identifiers are branded; use returned IDs or `herdr.ids` constructors.

| Purpose | Exact method shape and result |
| --- | --- |
| Create task layout | `workspaces.createInDirectory(cwd, { label, focus: false, env? }, options?)` → `{ workspace, tab, rootPane }`. |
| Add tab | `tabs.create({ workspaceId, cwd, label, focus: false, env? }, options?)` → `{ tab, rootPane }`. |
| Add pane | `panes.split(paneId, { direction: "right" or "down", cwd?, ratio?, focus: false, env? }, options?)` → `Pane`. |
| Submit agent launch | `agents.start({ name, kind, paneId, args?, timeoutMs? }, options?)` → `{ agent, argv }`. No `cwd` here; create the pane in the intended directory first. |
| Read identity/state | `agents.get({ kind: "agent", name }, options?)` or `agents.get({ kind: "pane", paneId }, options?)` → `Agent`. Shorthand `{ name }` and `{ paneId }` also parse. |
| Submit a turn | `agents.prompt(target, { text, wait?: { until?, timeoutMs? } }, options?)` → `Agent`, not response Markdown. |
| Wait without input | `agents.wait(target, { until?, timeoutMs? }, options?)` → `Agent`. |
| Inspect terminal output | `agents.read(target, { source: "recent_unwrapped", lines: 200, format: "text", stripAnsi: true }, options?)` → `PaneReadResult`. `panes.read(paneId, input, options?)` has the same read input/result. |
| Answer a terminal dialog | `agents.sendKeys(target, ["enter"], options?)` → void. Choose keys only after inspecting the dialog. |
| Raw terminal input | `panes.sendText(id, text, options?)`, `sendKeys(id, keys, options?)`, or `sendInput(id, { text, keys }, options?)` → void. These do not identify a semantic agent turn. |
| Wait for output | `panes.waitForOutput(id, { source: "recent", match: { type: "substring", value }, lines?, timeoutMs?, stripAnsi? }, options?)` → `{ paneId, revision, matchedLine, read }`. Matcher type may instead be `"regex"`. |
| Observe events | `events.subscribe(specs, options?)` → cold typed Effect `Stream`; `events.wait(match, { timeoutMs? }, options?)` → one typed event. |
| Reconcile current state | `session.snapshot(options?)` → one consistent resource/agent snapshot. |
| Attach native session reference | `panes.reportAgentSession(id, input, options?)`; this is metadata reporting, not a general session-resume command. |

Exact source contracts:

- `repos/herdr-ts-sdk/src/agent-service.ts:92-151,231-247,297-342`, `IAgentService` and `makeAgentService`.
- `repos/herdr-ts-sdk/src/herdr-models.ts:469-528`, `Agent`, including `status`, `launchPending`, `interactiveReady`, `agentSession`, and `stateChangeSequence`.
- Same file `1108-1142`, `TabCreateInput`/`TabCreateResult`; `1776-1784`, `PaneSplitInput`; `1241-1262`, `PaneReadSource`/`PaneReadFormat`; `1342-1384`, read results; `2025-2128`, read/input/output-wait inputs; `2813-2897`, launch/wait/prompt inputs.
- `repos/herdr-ts-sdk/src/event-service.ts:88-99,121-220`, `IEventService` and request/stream implementation.
- `repos/herdr-ts-sdk/src/workspace-service.ts:57-74,199-216`, `IWorkspaceService`/`createInDirectory`; `src/session-service.ts:27-64`, `ISessionService`/`makeSessionService`; `src/pane-service.ts:362-410`, terminal input and read/wait methods. The exact SDK spelling is `recent_unwrapped`; the CLI spelling is `recent-unwrapped`.

### Launch acknowledgement is not readiness

Verified difference: SDK `agents.start()` makes one `agent.start` request and returns its decoded result, `src/agent-service.ts:297-315`. Herdr's socket handler returns after command submission, `repos/herdr/src/app/api/agents.rs:73-80` and `src/app/agents.rs:145-231`.

The CLI adds shell-readiness retries and then `wait_for_named_agent`, checking expected terminal/kind plus `interactive_ready`; this work is in `repos/herdr/src/cli/agent.rs:355-433,562-635`. Do not transfer the CLI documentation's "start waits until ready" guarantee to the SDK.

Adaptation: after SDK launch, use a bounded readiness wait that re-reads `agents.get`, pins the returned terminal/kind, and requires `interactiveReady === true`, `launchPending === false`, and `idle` or `done`. `agents.wait` only checks status and can return too early for this purpose. A startup blocker is a distinct outcome to inspect, not permission to send a prompt. The server launch timer defaults to 30 seconds and accepts values greater than 3000 and at most 300000 milliseconds; it is not the SDK request deadline. Readiness transitions are explicit in `repos/herdr/src/terminal/state.rs:1910-2044`, `begin_managed_agent` and `reconcile_managed_agent_at`.

The SDK example `repos/herdr-ts-sdk/examples/multi-agent-idea-lab.ts:31-76` launches then prompts without this extra readiness loop and reads bounded terminal transcripts. Treat it as an example, not a production result protocol.

### Blocking, events, and completion reliability

Verified:

- Standalone `agents.wait` returns immediately if current status matches. Empty/omitted `until` defaults to `idle`, `done`, or `blocked`. See `repos/herdr/src/api/wait.rs:132-175,523-559`.
- `agents.prompt` rejects an already blocked agent with `agent_blocked` before writing. Otherwise it queues text and a delayed Enter, currently 300 ms. Success without `wait` acknowledges submission, not a new agent turn. See `src/app/api/agents.rs:13,111-218`.
- With `wait`, a prompt starting outside `working` must produce observed working/blocked activity within five seconds, unless the caller timeout expires first. After that it waits for the requested settled status. `agent_prompt_stalled` and timeouts do not prove non-delivery. A prompt sent while already working can be satisfied by completion of that existing turn. See `src/api/wait.rs:177-329,650-687`.
- A wait pins terminal identity and checks lifecycle changes, replacement, move, exit, and close, `src/api/wait.rs:364-517`. It still has no task ID, round ID, result hash, or semantic acceptance criterion.
- Herdr uses lifecycle hooks where available and screen/process detection otherwise. Full lifecycle hooks are authoritative while live, `src/terminal/state.rs:5-8`. Screen idle detection contains confirmation/debounce logic, `src/pane/agent_detection.rs:5-77`. Integration support is agent-specific; "installed integration" does not mean every status comes from a hook.
- `done` means idle completion not yet seen in the relevant presentation state; `idle` can mean finished or waiting. API seen state and individual TUI badges differ. Neither means "tests passed" or "review complete." See `docs/preview/website/src/content/docs/concepts.mdx:39-54`.
- Output waits search existing terminal snapshots immediately. Old text can match. Regex matching uses Rust regex syntax, line by line. Terminal reads expose `text`, `revision`, and `truncated`; they are not a transcript/artifact API. Large alternate-screen reads may actively scroll an idle agent and restore its viewport. See `docs/next/website/src/content/docs/agent-automation.mdx:78-103` and `src/api/wait.rs:22-129`.

SDK waits consume no model calls. They suspend an Effect on socket I/O; Herdr performs event/probe waits server-side. Some server loops poll at 100 ms, `src/api/server.rs:28`, so "blocking" does not mean the server has no periodic work.

The SDK's local request deadline defaults to five seconds. Set it longer than the server's `timeoutMs`, including submission/startup overhead. Server waits can be indefinite when their timeout is absent; the default SDK deadline still applies. See `repos/herdr-ts-sdk/README.md:79-123` and `src/herdr-transport.ts:523-565`.

Events are live-only, not a durable replay log. Example selectors include `{ type: "pane.agent_status_changed", paneId }` for subscription and `{ type: "pane.agent_status_changed", paneId, agentStatus: "blocked" }` for a one-shot match. Acquiring a cold stream happens when consumed, not when constructed. Interruption closes the socket. Reconnect must reconcile snapshots/artifacts rather than rely on seeing every transition. Evidence: `repos/herdr-ts-sdk/src/event-service.ts:121-220,444-475`; `src/event-service.test.ts:29-73` tests filtering and scoped socket closure. Protocol-error tests preserve `agent_prompt_stalled`/`agent_blocked` without retry, `src/herdr-protocol-22.test.ts:278-325`.

Adaptation: permit only one outstanding work round per agent session. Use lifecycle events as wake-up/diagnostic signals and an explicit artifact as the result condition. On uncertain submission, inspect current identity and durable round state before the AI operator decides whether to retry. Never automatically resend a prompt merely because a wait disconnected.

### Persistence and same-reviewer memory

| Event | Verified survival | Bridle implication |
| --- | --- | --- |
| Client detach, SSH loss, client crash | The background Herdr server and original pane processes keep running. | Reuse the same agent process for review rounds. |
| Herdr server/machine restart | Original processes do not survive. Snapshot restores layout/cwd/focus. | Reconcile before issuing work; restarting is not transparent continuation. |
| Optional pane-history replay | Recent screen content can return; history is off by default because terminal output may contain secrets. | History is neither live execution nor sufficient reviewer memory. |
| Native agent session resume | Eligible agents restart with their own persisted conversation reference. | Preserve agent session data and configuration, not just Herdr's snapshot. |
| Live handoff | Experimental best effort can preserve PTYs/processes; waits, sockets, subscriptions, and messages can be interrupted. | Reconnect and reconcile; do not blindly retry mutations. |

Evidence: `repos/herdr/docs/next/website/src/content/docs/session-state.mdx:8-108`; `tests/detach_reattach.rs:430-573`, detach and connection-drop tests; `src/persist/restore.rs:739-824`, `pane_restore_startup`, chooses native resume versus history and deduplicates references.

Native resume is enabled by default through `[session] resume_agents_on_restore`; pane history requires `[experimental] pane_history = true`. The pinned session-state documentation lists minimum Herdr integration versions including Pi 2, Claude 6, Codex 5, and OpenCode 5, `repos/herdr/docs/next/website/src/content/docs/session-state.mdx:35-82`. Persist those agents' own session files and credentials as well as Herdr state.

`repos/herdr/src/agent_resume.rs:53-86,114-235` validates official integration sources and builds native commands. Examples are `claude --resume <id>`, `codex resume <id>`, `pi --session <path-or-id>`, and `opencode --session <id>`. Ordinary custom reports are not arbitrary resume authority. There is also a narrow exception: `persisted_session_from_launch_args` recognizes exactly Codex `['resume', sessionId]`. Do not assume arbitrary agent launch arguments are persisted or reconstructed on restart.

Automatic restore normally waits for client size/theme context. `repos/herdr/src/app/agent_resume.rs:78-119` returns no candidates for an empty terminal area; `start_pending_agent_resume` checks theme context at `204-221`. The same file also has a terminal-specific startup path at `156-202`. Untested: whether Bridle's entirely unattended startup path supplies everything needed to resume all hidden panes. An SDK `clientShell` connection with explicit dimensions is a candidate to test, not yet a proven requirement or solution.

The SDK README's integrations table is stale: it lists only Codex/Qwen/Antigravity installation. The actual `IntegrationTarget` schema includes Pi, Claude, OpenCode, and others, `repos/herdr-ts-sdk/src/herdr-models.ts:744-762`; `src/integration-service.ts:47-62,80-108` exposes install/uninstall/list. Use source and `herdr integration status` when preparing the image.

Adaptation for reviewer continuity:

- Keep each specialist's pane and agent process alive across rounds. Send fixes, current commit/diff identity, and unresolved finding IDs into the same native conversation.
- Store reviewer role, Herdr server identity, current pane/terminal IDs, native session reference, round IDs, reviewed commits, findings, dispositions, and artifact hashes outside the conversation.
- After restart, resume the same native session where supported and verify identity. If resume fails, explicitly start a replacement reviewer with the stored findings and round history. Do not label it uninterrupted memory.
- Herdr does not prevent agent context compaction, `/clear`, session switching, or missing provider-side history. "Same reviewer memory" is strongest while the original process/session remains alive, not a permanent guarantee.

### Durable agent results and Markdown

Verified: no reviewed SDK method returns an agent's final semantic answer as a durable document. `agents.read` returns terminal text. Herdr itself recommends asking the agent to write Markdown and return its path when the response cannot be read completely, `repos/herdr/docs/next/website/src/content/docs/agent-automation.mdx:92`.

Adaptation: give each round a designated artifact path and an invocation/round ID before prompting. Ask the agent to publish `result.md` and a small result manifest only after it has finished the round. The manifest should identify the task, agent session, round, reviewed commit/diff, outcome, Markdown path/hash, findings, and evidence files. A trusted tool validates paths, schema, hash, size, and expected round before accepting the result. This is not an existing Herdr manifest format.

Publish with a temporary file and atomic rename/link, then persist the accepted document and manifest outside the disposable dev box before acknowledging completion. File publication, a local watcher, or a structured completion tool can wake the waiting execution tool without model polling. A terminal sentinel is only a fallback wake-up hint: prompt echo and old scrollback can match it before work finishes.

A file on the dev-box disk is not automatically durable across dev-box deletion. Namespace disk retention, external artifact storage, crash recovery, and exactly-once acknowledgement remain untested here. Herdr's session snapshot and screen history do not solve those concerns.

## Plannotator approval paths

### Native hooks are not the same as a strict gate

| Path | Verified behavior | Fit for Bridle |
| --- | --- | --- |
| Claude `PermissionRequest` for `ExitPlanMode` | CLI reads the plan, waits for browser approval, emits `hookSpecificOutput.decision.behavior: "allow"` or `"deny"`, then exits 0. Approval echoes original `tool_input` in `updatedInput` and may update session permission mode. | Permits leaving plan mode. It does not enforce a planner-only role or deliver approved Markdown as a standalone result. |
| Direct `annotate plan.md --gate --json` | Returns `approved`, `annotated`, or `dismissed` as one JSON line. By default all decisions exit 0. | Useful transport, but exit 0 alone is not approval. |
| Direct strict annotate | Adds `--require-approval` and optionally `--result-file`; distinguishes negative outcomes and gate errors. | Recommended initial candidate. It returns a decision, not an instruction to implement. |
| Annotate `--hook` | Implies gate. Approve **and Close** produce empty stdout; annotations produce `{"decision":"block","reason":"..."}`. Hook mode wins over `--json`. | Not a fail-closed human approval boundary; dismissal passes the hook. |
| Pi native plan mode | Defaults to executing after approval. `executionMode: "external"` emits a plan handoff and returns to idle. | Promising native alternative, with the headless hazard below. |
| OpenCode `submit_plan` | Can select/switch an agent and send "Proceed with implementation." Whether it starts implementation depends on selected agent/workflow options. | Must constrain handoff behavior; not planner-only by default. |

Evidence:

- Claude hook setup: `repos/plannotator/README.md`, manual hook setup, `PermissionRequest` matcher `ExitPlanMode`, timeout `345600` seconds. Runtime output: `repos/plannotator/apps/hook/server/index.ts:2443-2544`.
- Direct and hook formatting: `repos/plannotator/apps/hook/server/annotate-output.ts:19-77`, especially `formatAnnotateOutcome`.
- Strict flags and exit contract: `repos/plannotator/apps/marketing/src/content/docs/guides/annotate-gates-and-json-responses.md:117-172`; `apps/hook/server/strict-annotate-result.ts:17-87`.
- OpenCode handoff: `apps/opencode-plugin/submit-plan-executor.ts:120-165`. The backing plan file is unlinked on approval at `121-125`; do not assume that temporary path remains an artifact.

Claude compatibility caveat: the pinned hook source explicitly handles Claude Code `>=2.1.199` requiring `updatedInput` for the allow decision. It echoes the original tool input, not a newly returned approved Markdown document. Validate the exact host release before relying on the hook.

### Pi external handoff exists, but is not safe headlessly as shipped

Verified: `repos/plannotator/apps/pi-extension/config.ts:313-315` defaults execution mode to `automatic`. In `external` mode, `handoffApprovedPlan`, `repos/plannotator/apps/pi-extension/index.ts:641-658`, emits `plannotator:plan-approved` with `cwd`, `planFilePath`, `planContent`, and optional `feedback`; it restores the previous tools/model and returns to idle. The approved tool branch returns `terminate: true`, `repos/plannotator/apps/pi-extension/index.ts:1377-1390`. Types and event channel are in `repos/plannotator/apps/pi-extension/plannotator-events.ts:84-88,151-157`.

Critical mismatch: `repos/plannotator/apps/pi-extension/index.ts:1319-1349` auto-approves when `!ctx.hasUI || !hasPlanBrowserHtml()`. This also invokes the external handoff. Therefore external mode alone does not guarantee a human approved anything. Herdr normally runs an interactive agent terminal, but that is not proof that every startup, missing-asset, or recovery path has a usable Pi UI.

There is also a two-phase companion-extension API: `plannotator:request` action `plan-review` returns `{ status: "pending", reviewId }`, later emits `plannotator:review-result`, and stores queryable status. See `repos/plannotator/apps/pi-extension/plannotator-events.ts:135-169,247-280,356-389`. This is an in-process Pi event interface, not a remotely authenticated webhook or a Herdr event. Its status file is under `~/.pi/plannotator-review-status.json`, rather than the task's Plannotator data directory, and uses ordinary read/modify/write. It is not Bridle's durable routing record.

Adaptation: use the strict CLI gate first. If adopting Pi external handoff later, remove/override the auto-approve fallback with fail-closed behavior, persist handoff events through a companion tool, test `terminate` against the chosen Pi host, and independently constrain planner write/execute permissions. The upstream planning configuration is not a sandbox; its README explicitly leaves Bash unrestricted, `apps/pi-extension/README.md:310-315`.

### Recommended direct gate and exact exit semantics

Proposed invocation inside a task-scoped execution process, with paths allocated by Bridle:

```sh
PLANNOTATOR_REMOTE=1 \
PLANNOTATOR_PORT=19432-19439 \
PLANNOTATOR_SKIP_BROWSER_OPEN=1 \
PLANNOTATOR_AI=disabled \
PLANNOTATOR_SHARE=disabled \
PLANNOTATOR_DATA_DIR="$TASK_DATA/plannotator" \
PLANNOTATOR_READY_FILE="$ROUND_DIR/ready.jsonl" \
plannotator annotate "$PLAN_PATH" --gate --json \
  --require-approval --result-file "$ROUND_DIR/decision.json"
```

This is an untested invocation recipe, not code added to Bridle. The plan file and result parent directory must exist. The result destination must not exist. Do not enable `PLANNOTATOR_AGENT_TERMINAL_REMOTE`; the remote terminal must remain disabled. The all-interface remote bind must be confined to a private dev-box network behind the approval gateway described below.

Verified result contract:

| Human/process outcome | Stdout | Exit with `--require-approval` |
| --- | --- | --- |
| Approve | `{"decision":"approved"}` | 0 |
| Approve with notes | `{"decision":"approved","feedback":"..."}` | 0 |
| Send annotations | `{"decision":"annotated","feedback":"..."}` | 1 |
| Close | `{"decision":"dismissed"}` | 1 |
| Invalid flags/path, startup failure, publication failure | May have no decision; publication failure occurs after stdout decision | 2 |

Without `--require-approval`, `--result-file` alone does not change negative decisions to exit 1. Strict flags require direct `annotate --gate --json`, cannot combine with `--hook`, and are not the `annotate-last` contract. Inspect JSON and process outcome together; empty output, signals, timeouts, and malformed output are never approval.

`completeAnnotateCommand`, `repos/plannotator/apps/hook/server/annotate-command.ts:35-77`, waits for the decision, settles the browser, stops the server, writes stdout first, then the optional result file. Tests at `repos/plannotator/apps/hook/server/annotate-command.test.ts:61-227` cover outcome ordering, exit 1, publication failure, and stdout failure.

`writeAnnotateResultFile`, `repos/plannotator/apps/hook/server/strict-annotate-result.ts:129-157`, writes a private `0600` temporary file, fsyncs it, closes it, and hard-links it atomically without overwriting the destination. It does not fsync the parent directory. Thus publication is atomic to readers but not guaranteed against immediate machine power loss. Hard-link support is required; there is no non-atomic fallback. Tests at `repos/plannotator/apps/hook/server/strict-annotate-result.test.ts:214-321` cover permissions, races, cleanup, and unsupported hard links. Capture stdout even when using the file, and persist the reconciled decision externally before the operator acts.

### Waiting without model calls

Verified: `startAnnotateServer` builds a decision Promise and exposes `waitForDecision`, `repos/plannotator/packages/server/annotate.ts:630-672,1346-1354`. The CLI awaits it, `apps/hook/server/index.ts:1445-1452`. No model call is needed while waiting. `PLANNOTATOR_AI=disabled` disables the optional AI endpoints; it does not by itself disable the separate annotate terminal.

Local direct structured gates can dismiss after the last connected review client disappears for a 30-second grace period. This behavior requires at least one client to have connected. Half-open connections can take longer to detect. It is disabled for remote/tailnet sessions. See `apps/hook/server/annotate-output.ts:25-36`, `packages/server/annotate.ts:255-263,659-672`, and the client-lease tests at `packages/server/annotate.test.ts:1468-1547`.

Adaptation: a tool supervisor owns startup/approval deadlines and cancellation. It waits on the child and ready/result files, not repeated operator/model calls. Token expiry must revoke access and produce a distinct expired/cancelled tool outcome; remote Plannotator does not auto-expire the pending decision. Killing the Plannotator process loses its in-memory pending Promise. Reopening after restart requires an explicit new invocation and reconciliation of any already-persisted decision.

For multiple humans/tabs, direct annotate has first-decision-wins settlement and returns 409 to later decisions, `packages/shared/annotate-decision.ts:22-36` and `packages/server/annotate.ts:650-655,1142-1247`. Bridle should bind that winner to the current review invocation/revision in its own record. A display name is not authenticated identity.

### Returning approved Markdown without implementing

Verified: strict JSON contains only decision and optional feedback. It does not include Markdown, a plan hash, or a reviewed revision. The native plan server can save an approved snapshot and return `savedPath`, but users can disable plan save, and the CLI hook output does not transport that path as Bridle's result contract. See `packages/server/index.ts:506-597`.

A direct Markdown annotation can read current source bytes and save source edits, `packages/server/annotate.ts:567-619`, `getPrimarySource`, and `966-1025`, `/api/source/save`. Approval at `1155-1209` does not require a content hash. Reading the latest file after approval is therefore not proof those exact bytes were approved.

Adaptation for the prototype:

1. Planner writes a stable task plan and asks any outstanding questions through operator tools. The operator routes them to the originating conversation; any participant may answer.
2. Freeze a review revision. Store its Markdown bytes/hash before opening the gate. Serve only that revision; prevent source mutation during the review. If changes are requested or edited, create/reopen a new review revision rather than silently attaching approval to new bytes.
3. The gate tool publishes the protected live URL and blocks. On feedback it returns a revision request to the planner. Dismissal/expiry is not approval.
4. On a verified `approved` outcome, persist the decision, feedback, review revision/hash, and approved Markdown together. Return those bytes to the planner/operator result channel.
5. End the planner round. The AI operator alone chooses implementation agents and next actions. Do not append "proceed with implementation," switch the planner to a build agent, or allow a hook to infer approval from exit 0.

Exact-byte binding is a Bridle adaptation, not present in the upstream approval endpoint. Freezing should include filesystem/write restrictions or a gateway that rejects source mutations, not merely an instruction to the planner. After approval, verify the stored hash rather than trusting a mutable path. The approved Markdown must be durably stored before the planner is considered finished.

## Publishing a live review URL safely

### Ready URL and port concurrency

Verified: `handleServerReady`, `repos/plannotator/packages/server/shared-handlers.ts:225-309`, supports:

- `PLANNOTATOR_READY_FILE`: appends `{ url, isRemote, port }` as JSONL. Environment-configured write failures are best effort, not fatal.
- `PLANNOTATOR_SKIP_BROWSER_OPEN=1`: avoids browser launch.
- Remote URLs are printed to stderr independently of share settings.

The annotate CLI calls this helper through `handleAnnotateServerReady` in its `onReady` path, `apps/hook/server/index.ts:1413-1429`. Use a fresh private ready file per invocation and validate the returned port against the allowed range. The ready file is neither an authentication token nor a durable job record.

`packages/server/remote.ts:43-59,68-155` and `packages/shared/port-range.ts:13-35` establish:

- Local default port `0`, remote default `19432`.
- An explicit fixed port, including `0`, or inclusive range such as `19432-19439`.
- A range advances on `EADDRINUSE`; a fixed port retries five times at 500 ms intervals.
- Invalid configuration logs a warning and falls back, so Bridle should validate its environment itself.
- Local bind `127.0.0.1`; remote bind `0.0.0.0`.

`PLANNOTATOR_URL_HOST` changes only the advertised host in remote mode. `buildAdvertisedUrl`, `repos/plannotator/packages/server/remote.ts:176-191`, still formats `http://host:port`. It is not a TLS termination, arbitrary base-URL, or path-prefix proxy configuration. Have Bridle generate its own HTTPS review URL from the ready port.

A fixed remote port prevents simultaneous processes on one network namespace. A bounded range plus per-invocation ready metadata is the practical prototype choice. Across isolated task dev boxes the same internal port can be reused. The local session registry, `packages/server/sessions.ts:18-61,78-118`, stores PID/port/URL for discovery and checks PID liveness; it is not browser authentication or resumable approval state.

### Built-in share is an offline copy, not live approval

Verified: `repos/plannotator/packages/server/share-url.ts:25-76,107-130` compresses Markdown into a URL fragment, or encrypts and uploads HTML payloads to the paste service. The payload contains the document and annotations, not a callback URL to the pending review. It keeps the local server waiting. Remote annotate emits this additional document-only link when sharing is enabled, `apps/hook/server/index.ts:1420-1428`.

The README's Link sharing section describes manual import of teammate feedback. Small fragments are not encrypted; anyone or any messaging service holding the complete link can read them. Large/HTML short links carry the decryption key in the fragment and hosted pastes expire after seven days. This expiration is not expiration of a live approval bearer. Legacy open-source asynchronous sharing is moving toward deprecated support; hosted Workspaces is a separate product.

Adaptation: set `PLANNOTATOR_SHARE=disabled` so the operator does not publish the document-only link as if it were an approval link. Bridle needs ingress to the live server, not the share portal. Relevant URLs: <https://room.plannotator.ai/>, <https://share.plannotator.ai/>, <https://docs.plannotator.ai/open-source/workflows/sharing>.

### Host, origin, CORS, and session authentication

Verified by inspection of the actual Bun handlers, not by an internet exposure test:

- The plan handler starts with URL routing and serves `/api/plan`; its `/api/approve` and `/api/deny` routes have no general bearer/session authentication or request Host/Origin allowlist. See `packages/server/index.ts:251-334,506-650`.
- The direct annotate handler similarly serves `/api/plan` and accepts bodyless `/api/approve` without a bearer or Origin check. See `packages/server/annotate.ts:681-705,735-809,1155-1209`. Tests explicitly accept bodyless unauthenticated local approval at `packages/server/annotate.test.ts:1413-1433`.
- There is no blanket CORS/authentication middleware in these reviewed handlers. Browser same-origin protections are not an access-control boundary for non-browser clients, nor a replacement for CSRF protection. A network peer can issue requests directly.
- Some other components have origin checks. The annotate terminal's `isAllowedOrigin`, `packages/server/agent-terminal.ts:338-346`, permits an absent Origin or one whose host matches the request URL host. Its random WebSocket path is advertised in `/api/plan`; upstream explicitly says it is not an auth boundary, `repos/plannotator/packages/server/agent-terminal.ts:50-66,91-111`.
- `PLANNOTATOR_ORIGIN` means the originating coding-agent brand. It is not an HTTP Origin allowlist.
- Approval is only part of the application. There are linked-document, file-browser, source-save, upload, configuration, external-note, and optional AI routes. For example `repos/plannotator/packages/server/annotate.ts:907-1025,1032-1139,1251-1253`. Authentication that grants the entire app may expose more of the dev box than the plan.

Do not publish remote `0.0.0.0` directly. Unguessability of a public hostname or the PTY path is not sufficient. Session discovery files and preference cookies are not user authentication.

### Proposed bearer gateway boundary

Adaptation, requiring a security spike:

- Mint a cryptographically random bearer per task review invocation/revision, with explicit expiry and revocation. Store only a hash where practical. A proposed minimum is 128 bits of entropy. Possession grants approval rights; it does not identify the human.
- Bind the bearer to task ID, review invocation, immutable plan hash, backend dev box/port, and expiry. Reject tokens for old revisions and revoked/completed tasks. Ensure ports reused by later processes cannot inherit an old grant.
- Prefer an isolated review origin per task/invocation. Root-relative `/api/...` URLs make a bare `/tasks/<id>/<token>/` path prefix insufficient. Either implement and test full path rewriting or use a dedicated origin with a token exchange.
- A token exchange may create a short-lived Secure, HttpOnly, appropriately SameSite cookie and redirect to a token-free URL. The exchange itself must not approve; conversation link-preview bots must not consume the review or trigger a decision. Enforce the expiry on every request and any ongoing streams, not just initial HTML access.
- Authenticate HTML, assets, reads, decision POSTs, SSE, and any WebSocket upgrades. Validate the public Host and exact Origin for state-changing browser requests; add CSRF defenses if using cookies. Do not treat forwarded headers supplied by callers as trusted.
- Redact tokens from logs, tracing, and analytics. Use TLS, `Referrer-Policy: no-referrer`, non-cacheable private responses, and no shared public cache for plan/API data. Consider third-party scripts/content when evaluating token and document leakage.
- Keep backend ports private. With remote mode, firewall/private-network restrictions must prevent bypassing the gateway, including access from unrelated workspaces. If using a same-box loopback gateway instead, explicitly handle local client-lease behavior and disable/block the separate terminal; `PLANNOTATOR_AI=disabled` is not enough.
- Limit the exposed app to the reviewed plan. Constrain reference roots and deny unnecessary mutation, terminal, AI, upload, configuration, external-note, and filesystem-browsing routes. Test the route allowlist against the actual UI so failure does not silently fall back to a broader route set.

The last point also needs an execution trust decision. If a planner runs as the same OS user with unrestricted shell/network access, it can reach the local unauthenticated approval API or forge local result files. An external bearer proxy alone does not prove human provenance against that agent. For a stronger gate, run the approval service/result writer outside planner access, or require the gateway to attest the authenticated decision and reject uncorroborated backend outcomes. A source-level backend token check would also need a token hidden from the planner. Do not pretend task IDs in a JSON file solve this.

No proof was obtained that Namespace ingress, Cloudflare proxying, and these Bun servers interoperate unchanged. Nor was multi-tenant isolation validated.

### Proxy and WebSocket requirements

For basic Markdown approval, HTTP GET/POST is enough for the core decision. The UI also uses streaming endpoints, including reference-file updates, external annotations, and local client leases. Preserve streaming responses, disable buffering where required, and choose idle/time limits appropriate for human review. The Bun server sets `idleTimeout: 0`, `packages/server/annotate.ts:685-689`; an outer proxy may still terminate streams.

The optional annotate agent terminal needs WebSocket upgrade/tunnelling. Keep it disabled for Bridle's plan gate. If ever enabled, authenticate the upgrade, enforce expiration for the live connection, and reconcile public versus backend Host/Origin checks. The terminal bridges to a separate Node/WebTUI runtime, `packages/server/agent-terminal.ts:68-127`; it is not part of Herdr's session control.

Do not confuse this with `annotate --app` live-app proxying. That mode is deliberately refused in remote/tailnet sessions, `apps/hook/server/index.ts:1351-1367` and `packages/server/annotate.ts:265-282`. Its dedicated proxy binds loopback and has its own origin/WebSocket protections, `packages/server/live-proxy.ts:100-108,154-174`. Bridle's Markdown gate does not require it.

## Minimal compatibility spikes

Run these only in disposable copies/images, not in the read-only subtrees. They are proposed, not completed.

| Spike | Smallest useful test | Pass criteria |
| --- | --- | --- |
| 1. Package and launch | Separately build/pack the pinned SDK; start pinned Herdr in an isolated Namespace image. Ping, create workspace/tab/pane, launch one chosen real agent, observe readiness, prompt once, read output. | Protocol 22, package imports work on the chosen Node/Effect versions, startup respects `interactiveReady`, no duplicate input on transient failure. Record image/runtime/agent versions. |
| 2. Wait semantics and results | One slow turn, one blocked dialog, one immediate response, one prompt timeout, and one interrupted subscription. Have the agent publish a round-tagged Markdown artifact/manifest. | Waits do not consume model turns; `blocked`/`idle` never falsely certify completion; stale markers and previous-round artifacts are rejected; reconnection reconciles state without resubmitting. |
| 3. Reviewer continuity | Two rounds in one native session; detach/reattach between them. Then restart Herdr with persisted native session data, with no human TUI attached. | Same native conversation where supported; recovery starts unattended or identifies the required sizing/theme path; findings survive independently; unsupported resume is explicit. |
| 4. Strict gate and bytes | Launch direct annotate with ready/result files. Exercise approve, approve-with-notes, annotations, Close, invalid path, existing destination, unsupported hard link, killed process, and source mutation during review. | Exact JSON/exit contract; stdout retained on file failure; no auto-approval; decision bound to immutable Markdown; no planner implementation after return. |
| 5. Public ingress | Put one gate behind the proposed token gateway. Test absent/wrong/expired/revoked/cross-task tokens, stale revision, link previews, CSRF, hostile Host/Origin, direct backend access, two simultaneous reviewers, reload and tunnel loss. | No document or decision access without the current grant, one recorded winner, no backend bypass, no token leakage, long waits work without model polling. |
| 6. Concurrency and recovery | Start two gates in one dev box, occupy the first port, exhaust the range, kill/restart a gate, then reuse its port. | Correct ready-port mapping, old links cannot reach new reviews, result paths never overwrite, expired waiters clean up, operator/DO recovery does not infer approval from missing processes. |

If choosing native Pi instead of the direct gate, add an explicit missing-UI/missing-HTML test before any deployment. It must fail closed despite the pinned default. Test external handoff persistence and absence of an implementation turn. For Claude/OpenCode, test host-version-specific hook/agent-switch behavior and independent planner restrictions.

## Open questions

1. Which coding agent and exact release will Bridle standardize on first? Herdr detection, startup UI, native restore, and Plannotator host behavior all depend on this choice.
2. Which Effect v4 prerelease will Bridle use, and how will it consume a pinned SDK package while the README describes it as unpublished?
3. Will tasks keep reviewer processes alive until final human review, and how long do agent conversation files and dev-box disks survive? What external store owns Markdown/findings after box deletion?
4. Can automatic native resume run entirely unattended in the target image? Does it need a client-shell sizing/theme bootstrap or an explicit native resume launch?
5. Will the prototype prohibit source edits during approval, or support edited Markdown with a new revision and re-review? The upstream decision does not attest a content hash.
6. Is the planner considered capable of bypassing local approval endpoints? If yes, what OS/service separation or gateway attestation establishes human provenance?
7. What token lifetime, reissue rules, expiry-versus-approval race policy, and audit detail are required? Bearer links authorize whoever holds them, not a named reviewer.
8. Which Namespace ingress topology can keep the backend private while supporting the required HTTPS host routing and streaming behavior? This research did not verify Namespace networking APIs.
9. Which Plannotator routes are necessary for the prototype UI, and which must be denied to prevent plan reviewers from accessing workspace files, terminals, configuration, or optional AI services?
10. How will the execution tool reconcile a browser-reported success when stdout/result publication or external persistence fails? Source behavior allows a human decision to exist before the final result file.

## Online documentation and evidence limits

- Read <https://herdr.dev/agent-guide.md>. It corroborates session/workspace/tab/pane terminology, detached process survival, and the distinction between lifecycle integrations and native restore. The pinned source above governs conflicts.
- Upstream references for follow-up: <https://herdr.dev/docs/socket-api/>, <https://herdr.dev/docs/session-state/>, <https://herdr.dev/docs/agent-automation/>, <https://herdr.dev/docs/integrations/>. Local pinned equivalents were used for detailed claims; these additional live pages were not fetched.
- Requested installation reference: <https://docs.plannotator.ai/open-source/start/installation>. This subagent's scrape attempts were rate-limited. The parent research session successfully read the installation page, which corroborates minimal/binary-only installation and release pinning; the detailed behavior in this report still follows the pinned source. Installation/runtime conclusions use the pinned README, package manifests, and source instead. The README recommends a `--minimal` binary-only install and release pinning; do not let the general installer silently configure every detected agent in a Bridle image.
- No live Herdr/SDK compatibility, real-agent turn completion, crash durability, browser/proxy behavior, or public-ingress security test was performed. The spikes above are the remaining evidence needed before selecting an integration contract.
