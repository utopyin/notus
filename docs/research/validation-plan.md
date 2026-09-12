# Integration validation plan

Proposed experiments, not deployment permission or an implementation backlog. None has run. Integration notes own source evidence; this file owns unresolved technical experiments and success criteria. Product decisions remain in [CONTEXT](../../CONTEXT.md), ownership in [the codebase plan](../plans/codebase.md).

## Execution rules and prerequisites

Use disposable fixture projects/images outside read-only `repos/`. Use the selected Alchemy workflow for deployment, with local workerd checks where useful. Live work requires explicit credential authorization, spend/resource limits, and cleanup ownership. Never run upstream examples assuming they are harmless tests.

Each result must record exact normal-package versions, artifact/image digests, runtime version, Worker compatibility date, workspace policy, protocol fixtures, observations, failures, and cleanup. Do not record credentials. Update [sources](sources.md) when references change; do not copy its version table here.

Before credentialed experiments:

- Confirm the intended billing constraint and permitted shared-workflow identity. Ask OpenAI about member-token allowance, service-account requirements, concurrency, independent OAuth/backend support, and any selected app-server support. Technical success cannot establish commercial permission.
- Resolve the historical auth-reference provenance in [OpenAI evidence](openai-auth.md#local-implementation-evidence). Start with the reported Effect OAuth/client pattern; Codex with MCP remains an alternative, dynamic tools only if needed. API billing needs explicit acceptance.
- Select the first specialist host/release and representative private QA repository. Use product planning for trigger UX, credential selection, handoff, limits, and retention rather than silently deciding them during a spike.

## Package and host compatibility

Start without credentials. Evidence: [sources](sources.md), [Effect](effect-v4.md), [Alchemy](alchemy.md), [Herdr](herdr.md), [Namespace](namespace.md).

- Recheck published artifacts/exports/license completeness, particularly Herdr and Namespace. Select a reproducible normal-package graph; separately build an artifact if authorized and necessary.
- Compile minimal service, Schema, toolkit, HTTP client, and Node entrypoint; separately import/build the Worker closure. Check transitive engines and runtime behavior, not only declared peer ranges.
- Exercise Herdr handshake, layout creation, and socket round trip with the selected binary. If its Effect dependency remains incompatible, validate an updated package or a separately packaged/process boundary, not casts or forced overrides.
- Verify the Distilled Worker export path through the actual Alchemy build. Package import success alone does not pass transport execution.

Pass when reproducible artifacts run on each intended host without hidden incompatible defaults. Stop if no supported package or safe adapter boundary exists; do not import `repos/` as a workaround.

## Operator model and credential lifecycle

Evidence: [OpenAI](openai-auth.md), [Effect](effect-v4.md). Use fake HTTP/model fixtures before authorized requests.

- Exercise text, tools/results, transformed arguments, structured output, partial streams, finish reasons, encrypted reasoning and assistant phase continuity, model discovery, errors, and cancellation on the selected backend. Unsupported features must fail explicitly.
- Cross access-token expiry during an active operator session. Concurrent consumers must use one serialized refresh owner with atomic rotated-token persistence. Include restart during renewal, transient failure, revocation, reconnect-required, and disconnect/revoke behavior. Never clone a refresh lineage across devboxes.
- Verify actual account/workspace usage attribution and absence of inherited API-key fallback. Inject quota failures rather than exhausting a real subscription.
- Check specialist-host consumption of the managed connection separately from the operator. Codex-managed caches, access tokens, and external-token callbacks have different refresh contracts.
- With synthetic sentinel secrets, test repository processes, agent tools, subprocess environments, logs/traces, screenshots, histories, and artifacts for credential leakage. For federation, include assertion expiry, protected paths, and replay protection.

Pass when required model/tool behavior works, renewal survives intended concurrency, permissions remain scoped, and auth/quota failures pause/report without silently changing billing. Record provider-support questions separately even after success.

## Namespace provisioning and lifetime

Evidence: [Namespace](namespace.md). Compare local mock-backed fetch/descriptor lifecycle calls with a trusted Node SDK/CLI adapter before choosing topology.

- With authorization, create/fetch/activate/stop/delete one pinned-image box. Confirm private RPC support and the required grants. Drop create/start responses and reconcile by persisted assignment without another allocation.
- Require supervisor-ready only after checkout, selected tools, and task credentials are ready. Disconnect provisioner clients; the operator must not depend on an open SDK call. Repeat boot and operator restart without duplicate assignments.
- Test hook/session startup semantics and unattended Herdr readiness. Validate explicit repository/ref selection, inherited defaults, approved clone/push/PR access, denied unapproved access, workload-token scope, and any required submodules/LFS.
- Cross idle and token-expiry boundaries with and without task markers. Confirm marker cleanup after success/caught failure, and document external cleanup for lost ownership. Determine provider continuous-runtime caps and stopped-retention policy.
- Stop/start during work and review; identify actual persistent paths and process loss. Never report killed work as completed or assume a restored layout preserves a pending callback.
- Measure representative build/agents/browser QA under the chosen size, egress, and privilege settings, including OOM, sandbox/shared memory, and output growth. Validate secret-backed environment/header injection only if selected.

Pass when the chosen control/bootstrap path works without an hours-long provisioning call, authority is acceptable, failures reconcile, required QA works, and retention/cleanup costs are bounded. If review cannot restart safely, planning must account for keeping compute alive.

## Herdr invocation, continuity, and long waits

Evidence: [Herdr](herdr.md). Start with a simulated slow worker, then one harmless real-agent invocation before code edits.

- Launch into a prepared pane and verify interactive readiness independently of launch acknowledgement. Exercise immediate result, blocked dialog, old done-state, echoed sentinel, stale file, and lost prompt response.
- Publish a new invocation/revision-tagged result. Validate path/schema/size/hash and reject old artifacts. Permit only one outstanding invocation per session; parallel sessions need an explicit concurrency bound and completion-order-independent results.
- Detach/reconnect during a turn. Subscription interruption must reconcile snapshots/results without duplicate prompting. Separately request cancellation and observe termination or an explicit unknown outcome, including late completion.
- Reuse a native reviewer session for two rounds. Restart Herdr with session data and no human TUI; establish whether dimensions/theme bootstrap is required. Unsupported resume must be explicit, with findings retained independently.
- Hold the preferred tool wait for at least two hours with explicit SDK/server/outer deadlines and a transport interruption. Count operator model calls during the wait. If the host cannot safely hold it, evaluate recorded wait intent plus event-driven resume of the same stored operator thread.

Pass when no waiting model calls occur, stale state cannot complete new work, client detach differs from cancellation, duplicate completion is consumed once, and caught failures reach intervention. Document silent-host-loss detection gaps; full automatic crash recovery is not a prototype prerequisite.

## Trusted public approval

Evidence: [Plannotator](plannotator.md), [Namespace ingress](namespace.md#review-ingress-and-qa). Use a frozen Markdown revision, strict direct gate, disabled optional AI/sharing/terminal, and private backend. First browser must have no Namespace session.

- Validate approve, approve-with-notes, annotations, Close, invalid flags/path, missing UI/assets, existing result path, unsupported hard link, killed process, malformed output, and stdout-success/file-failure. Only a reconciled trusted positive outcome may approve.
- Ensure source mutation cannot change approved bytes. Persist the accepted revision/hash/Markdown and gateway provenance. Agent access to local endpoints/files must not forge that record.
- Test absent, wrong-task, expired, revoked, completed, and old-revision capabilities on reads, decisions, assets, streams, and upgrades. Exercise expiry-versus-approval races, concurrent reviewers, link previews, CSRF, hostile Host/Origin, forwarded headers, and direct-backend bypass.
- Validate root-relative UI routing, required route allowlist, no filesystem/terminal/operator exposure, token redaction, private caching, and referrer behavior. A document-only share link does not pass.
- Exercise reload, proxy/relay loss, sleeping box, stream deadlines, two concurrent gates, occupied/exhausted port ranges, process restart, and port reuse. Old links must not reach replacement reviews; expired/cancelled waiters must clean up.
- Confirm the planner returns the exact approved Markdown without implementing. If selecting a native host integration later, separately test its handoff/termination and missing-UI fail-closed behavior.

Pass when an anonymous valid link supports review through the trusted gateway, one accepted outcome binds exact bytes, negative/failure paths never approve, and unrelated devbox access is denied. Resolve private ingress or outbound-relay transport before claiming public approval works.

## Control storage and Slack

Evidence: [Cloudflare](cloudflare.md), [Slack](slack.md). Start with fake source delivery, then the selected Slack HTTP adapter. Deploy one SQLite-backed task DO through Alchemy with an inbound hibernatable devbox socket.

- Verify raw-body signatures, timestamp freshness, actor/installation mapping, bot filtering, retries, required scopes, and thread replies. Acknowledge promptly after durable admission, not after provisioning/model work.
- Replay task-start events before and after task creation; recover the same task/operation. Wrong-workspace, expired, and obsolete-execution credentials must fail. Review tokens must not authorize operator/control calls.
- Reconstruct/hibernate/redeploy the DO and reconnect with cursors. Preserve questions, answers, findings, pending deliveries, and accepted decisions. Validate transactions/rollback and concurrent requests in the actual runtime, not only fake SQLite tests.
- Disconnect after an outbound send but before recording its acknowledgement. Establish Distilled/Slack retry and error behavior; record unavoidable delivery ambiguity instead of promising exactly-once notifications.
- Verify bounded message sizes, HTTP/SSE/abort behavior, no long-wait model/fiber requirement in the DO, and no Node-only imports in Worker execution.

Pass when admitted events and replies survive reconstruction without duplicate allocation, authority checks hold, and notifications return to the recorded origin thread.

## Dispatch persistence and end-to-end evidence

Evidence: [Effect](effect-v4.md) and the provider notes above. Use mock failure injection before the representative repository.

- Compare journaled auto-resolution with manual tool dispatch. Interrupt before/after intent save, side effect, result save, and chat save. Cover pending approvals, incomplete streams, concurrent chat loads, failed automatic saves, restored response IDs, metadata retention, and bounded history/compaction. No path may blindly replay uncertain effects.
- Run a genuine finding → fix → re-review cycle plus QA and human handoff. Record base, implementation, reviewed, and handed-off revisions. Do not reuse review evidence after concurrent source mutation.
- Include empty findings, a repeated unresolved defect, and reviewer disagreement. The model chooses the next action; runtime validation must not equate a text-only turn or process exit with completion.
- Demonstrate another human-requested cycle and the no-merge boundary through actual credential restrictions, not just tool omission.
- Export accepted artifacts, delete the box, and read evidence back independently. If using Namespace artifacts, test create/PUT/finalize retry ambiguity, version-specific readback, signed-URL renewal, and expiry.

Pass when evidence applies to the final revision, findings survive session/box loss, required human boundaries hold, and manual intervention can resolve explicit ambiguous outcomes. Then write infrastructure and service implementation plans around the measured path, including unresolved support assumptions, retention, and cleanup.
