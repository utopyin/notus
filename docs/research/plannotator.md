# Plannotator integration evidence

Paths are relative to `repos/plannotator/`. Versions are in [sources](sources.md); the [validation plan](validation-plan.md) defines the public-review experiment.

## Direct strict gate

Candidate command for an immutable review file:

```sh
plannotator annotate "$PLAN_PATH" --gate --json \
  --require-approval --result-file "$ROUND_DIR/decision.json"
```

The plan and parent directory must exist; result destination must not exist. Strict flags require direct `annotate --gate --json`, not `--hook` or `annotate-last`. Evidence: `apps/hook/server/{annotate-output,annotate-command,strict-annotate-result}.ts`; `apps/marketing/src/content/docs/guides/annotate-gates-and-json-responses.md`.

| Outcome | JSON decision | Strict exit |
| --- | --- | --- |
| Approve, optionally with notes | `approved`, optional `feedback` | 0 |
| Request changes | `annotated`, with feedback | 1 |
| Close | `dismissed` | 1 |
| Invalid input, startup/publication failure | Decision may be absent | 2 |

- Without `--require-approval`, negative decisions also exit zero. Hook mode permits both approval and Close with empty stdout. Neither exit zero nor empty output proves human approval.
- Strict output contains no Markdown, plan hash, or revision. `packages/server/annotate.ts` can reread source and exposes `/api/source/save`; approval does not require a content digest. Reading a mutable file after approval cannot establish what bytes were reviewed.
- `annotate-command.ts` writes stdout before the result file. Publication can fail after the browser decision and stdout succeed. Inspect process outcome and structured evidence together; reconcile rather than infer success from partial output.
- `strict-annotate-result.ts` uses a private temporary file, fsync, then atomic hard-link publication without overwrite. Hard links are required; no fallback exists. It does not fsync the parent directory, so atomic visibility is not power-loss durability. Relevant tests are `annotate-command.test.ts` and `strict-annotate-result.test.ts`.

## Process configuration and waiting

Evidence: `packages/server/{annotate,remote,shared-handlers,sessions}.ts`, `packages/shared/{port-range,annotate-decision}.ts`.

- The standalone binary bundles Bun; source execution needs Bun and built UI assets. Minimal binary-only installation avoids configuring every detected agent. See the pinned README and [installation docs](https://docs.plannotator.ai/open-source/start/installation).
- `PLANNOTATOR_REMOTE=1` binds all interfaces, not authentication. Local mode binds loopback. An explicit `PLANNOTATOR_PORT` range permits concurrent processes; invalid configuration warns and falls back, so validate it before launch.
- `PLANNOTATOR_READY_FILE` appends `{ url, isRemote, port }` JSONL best-effort. A failed write need not stop the server. Use a fresh private file and validate the port/instance association. Registry PID/port records are discovery, not durable review state.
- `PLANNOTATOR_URL_HOST` only advertises `http://host:port`; it provides neither TLS nor path-prefix proxy support. `PLANNOTATOR_SKIP_BROWSER_OPEN=1` suppresses browser launch. Scope `PLANNOTATOR_DATA_DIR` per task.
- Disable `PLANNOTATOR_AI` and `PLANNOTATOR_SHARE`. Do not enable `PLANNOTATOR_AGENT_TERMINAL_REMOTE`; AI disablement alone does not disable the separate terminal.
- `waitForDecision` awaits an in-memory Promise without model calls. Process loss loses that waiter. Remote/tailnet gates do not auto-dismiss on client disconnect. Local direct structured gates can dismiss after the last connected client disappears for a 30-second grace period, but only after a client has connected; half-open connections may take longer.
- Decisions settle first-wins, later submissions return 409. Display names are not authenticated identities. Token expiry does not expire Plannotator's Promise; a supervisor must end/reconcile the invocation.

## Public access and human provenance

Evidence: route handlers in `packages/server/{index,annotate}.ts`, tests in `annotate.test.ts`, terminal comments in `agent-terminal.ts`.

- The reviewed plan/annotate servers have no general bearer authentication or Host/Origin allowlist. Direct annotate accepts bodyless unauthenticated approval. CORS is not authorization against network peers. `PLANNOTATOR_ORIGIN` means agent brand, not HTTP Origin policy.
- Backend routes include source mutation, linked files, browsing, uploads, configuration, external notes, and optional AI/terminal operations. A reverse proxy that authenticates the whole app can expose far more than the plan. Identify and allow only routes needed by the review UI.
- The optional terminal's random WebSocket path is advertised in `/api/plan`; upstream explicitly says it is not an auth boundary. Its Origin check permits absent Origin. Never expose Herdr/operator endpoints through review access.
- The gateway needs private backend reachability. Namespace's documented URLs require its own authentication; see [Namespace ingress evidence](namespace.md#review-ingress-and-qa). A public remote bind must not permit gateway bypass.
- Root-relative `/api/...` URLs make a bare task path prefix insufficient. Use an isolated origin or verified rewriting. Apply capability expiry/revocation to HTML, assets, reads, decisions, streams, and upgrades, including existing connections. Port reuse must not transfer an old grant to a new review.
- A token-to-cookie exchange must not approve or consume the review on a preview GET. Cookie sessions need CSRF protection and exact public Host/Origin checks. Forwarded headers are trusted only from the controlled proxy. Use TLS, private non-cacheable responses, no-referrer policy, and token redaction; assess third-party resource leakage.
- Repository-controlled processes sharing the backend's OS/network access can call its unauthenticated approval route or forge local files. An external bearer proxy alone does not prove a human acted. Require a gateway-attested decision bound to immutable bytes, or isolate the approval service/result writer from those processes. Task IDs in JSON do not establish provenance.
- Basic approval uses HTTP, but the UI also has SSE for references, external annotations, and client leases. Preserve required streams without buffering; upstream `idleTimeout: 0` does not remove outer-proxy deadlines. Optional terminal WebSockets remain unnecessary for a Markdown gate.
- `annotate --app` is separate live-app proxying and is refused remotely. Its loopback proxy protections do not protect the ordinary Markdown server.

## Sharing and native-host hazards

- `packages/server/share-url.ts` creates offline document copies, not callbacks to a pending gate. Small URL fragments are readable by anyone holding the full link; larger/HTML shares put the decryption key in the fragment. Hosted paste expiry is not live approval expiry. [Sharing docs](https://docs.plannotator.ai/open-source/workflows/sharing).
- Claude's `ExitPlanMode` hook allows leaving plan mode and echoes original `tool_input` as `updatedInput`. It does not return a standalone approved Markdown artifact or enforce planner-only behavior. Evidence: `apps/hook/server/index.ts`.
- Pi defaults to automatic execution. External mode emits `plannotator:plan-approved` with Markdown/path/feedback, restores tools, and returns idle. However, missing UI or HTML assets auto-approves even in external mode. This must fail closed before adopting that integration. Evidence: `apps/pi-extension/{config,index,plannotator-events}.ts`.
- Pi's pending/review-result companion API is in-process, not a remote authenticated callback. Its status file uses ordinary read/modify/write outside task-specific storage. Planning mode leaves Bash unrestricted and is not a sandbox.
- OpenCode can switch agents and send "Proceed with implementation"; approval also unlinks the temporary plan. Host capability and version matter. Evidence: `apps/opencode-plugin/submit-plan-executor.ts` and README.

The direct strict gate avoids those host-specific automatic handoffs, but does not itself solve exact-byte binding, trusted approval, or durable publication.
