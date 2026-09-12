# Integration validation plan

Status: proposed experiments, not permission to deploy or a finalized implementation backlog. No experiment below has been run. The purpose is to remove the specific uncertainties found in the source research before writing the full infrastructure and Effect service plan.

Use disposable fixture projects or separate build checkouts. Keep `repos/` read-only. Record package versions, image digests, runtime versions, protocol fixtures, compatibility dates, actual observations, and cleanup results for every experiment. Do not record credentials.

## 0. Identity and billing decision

Decide whether the constraint is no OpenAI Platform API billing or strictly subscription-included usage. Select a permitted identity for a shared team workflow. Official workspace service accounts require pay-as-you-go; member-owned Codex tokens support trusted automation but do not by themselves establish entitlement for every teammate's jobs.

Then select the operator candidate:

- Codex with Effect-backed MCP tools, subscription/workspace entitlement permitting.
- Codex app-server with experimental dynamic tools if the extra control is required.
- An API-backed Effect model loop only if the user accepts API billing.
- A custom Codex `LanguageModel` adapter only if preserving that exact interface justifies the additional protocol work.

Pass evidence: explicit user choice, available account/workspace capabilities, and provider confirmation where shared use or support terms remain unclear. Do not infer commercial permission from a successful login.

## 1. Package and runtime compatibility

No credentials or cloud resources required.

1. Recheck public package versions and inspect their exports. Herdr and Namespace documentation currently run ahead of an established installable dependency set.
2. Select exact matching Effect ecosystem versions. Test an updated Herdr SDK if available. If it remains on a different prerelease, evaluate a separately packaged/process-isolated adapter rather than casting incompatible effects or forcing overrides.
3. Compile a minimal v4 service, Layer, Schema codec, and toolkit using normal dependencies. Check a Node entrypoint and Worker-compatible shared module separately.
4. Start pinned Herdr in a disposable local test environment if supported. Validate SDK import, protocol handshake, workspace creation, and a socket round trip.

Pass evidence: reproducible lockfile/artifact, compatible Node version, passing imports/typechecks, and protocol 22 handshake. The primary Effect pin's transitive dependencies require at least Node 22.19.0; validate the final dependency graph rather than relying on a package's broad engine declaration.

Stop condition: no installable/supported package or safe adapter boundary. Do not solve it by importing `repos/` into Bridle.

## 2. Namespace provisioning and bootstrap

Begin with local HTTP mocks. Live work requires explicit cloud authorization, a maximum resource count, and cleanup ownership.

Compare a fetch-compatible unary lifecycle adapter with a trusted Node SDK/CLI adapter. Do not spend time expecting Workers compatibility flags to implement Node HTTP/2.

Create one task dev box with a pinned image and explicit repository assignment. Require a supervisor-ready acknowledgement only after checkout, tools, and task credentials are ready. Disconnect the provisioning client and confirm the operator host remains available. Repeat start/stop to identify actual persistent paths and process loss.

Pass evidence:

- Create/fetch/start/stop/delete work through the selected supported path.
- Startup does not require holding an hours-long SDK call open.
- A lost create response can be reconciled without blindly allocating another box.
- Workload/GitHub grants are understood and acceptably scoped.
- Required tools are ready before the first agent prompt.

## 3. One operator and one Herdr worker

Use a private fixture repository and an authorized model identity. Start with a harmless result before requesting code edits.

The operator chooses to launch one worker through an Effect tool. The tool records the invocation, creates its pane, launches the agent, and checks actual interactive readiness. The worker writes a round-tagged Markdown result. The tool validates the invocation and artifact, then returns it for the operator to interpret.

Pass evidence:

- Launch acknowledgement is not confused with readiness.
- Old `done` state, echoed prompts, and stale artifacts cannot complete the new round.
- One outstanding round per worker session prevents cross-turn confusion.
- Submission timeout triggers reconciliation, not automatic duplicate prompting.
- The operator chooses the next action; the runtime only executes and records it.

## 4. Hours-long waiting and interruption

First use a simulated slow worker so model cost is not required to test timing. Then validate the selected real-agent path.

Test the preferred long-running tool with explicit SDK/server/MCP deadlines. Confirm no operator model calls occur while waiting. Cover at least a two-hour interval and transport disconnection. If the selected host cannot safely hold the callback, evaluate ending the turn with recorded wait intent and resuming the same operator thread on completion.

Run Namespace's idle behavior both with and without active-task markers in a controlled fixture. Confirm marker cleanup after success and caught failure. Do not intentionally leave a billable box running after the test.

Pass evidence:

- Agent work continues across expected client detach.
- Unexpected dev-box stopping is not reported as successful work.
- Disconnecting an observer is distinct from cancelling the worker.
- A completion delivered twice is consumed once.
- Parallel jobs preserve their result identities and have an explicit concurrency bound.
- Caught failures produce intervention messages. Document any silent-host-loss detection gap rather than adding full autonomous recovery by assumption.

## 5. Public human approval

Use the direct strict Plannotator gate against an immutable Markdown revision. Disable optional AI, sharing, and terminal capabilities. Put it behind the proposed bearer gateway; do not expose the unauthenticated backend directly.

The first browser test must use a browser without a Namespace session. Possession of the Bridle review link, not Namespace membership, is the agreed prototype authorization.

Pass evidence:

- Valid link loads the required UI and permits approval or revision feedback.
- Missing, wrong-task, expired, revoked, and old-revision links fail on reads, writes, and streams.
- Source edits cannot change which bytes an approval authorizes.
- Dismissal, browser failure, missing UI/assets, killed process, and malformed result never become approval.
- Link previews never approve a plan or consume a human decision.
- Concurrent reviewers produce one recorded accepted outcome; later attempts are explicit.
- The persisted decision includes the exact plan revision and approved Markdown.
- The planner returns the plan and does not implement. The operator subsequently decides the implementation action.
- Local agent access cannot forge the trusted human-approval record.
- Public review access cannot browse unrelated files, open a terminal, or reach Herdr/operator controls.

If the gateway cannot reach a private Namespace backend reliably, resolve the ingress or outbound-relay design before proceeding. A read-only Plannotator share URL does not pass this test.

## 6. Durable Object transport and one input adapter

Use SQLite-backed task storage and an inbound devbox-to-DO hibernatable WebSocket. Start with a fake input adapter; integrate the first real source only after it is selected.

Pass evidence:

- Source events are authenticated and duplicate task requests do not allocate another task.
- Status, findings, questions, answers, and pending deliveries persist through DO reconstruction.
- Reconnect exchanges event cursors and does not lose a human answer.
- Wrong-workspace and obsolete-execution messages are rejected.
- Notifications return to the original conversation, not a model-selected arbitrary recipient.
- No model call or long-lived fiber is needed inside the DO to wait for a human.
- Delivery ambiguity is documented; do not claim exactly-once Slack/Linear side effects without integration-specific evidence.

## 7. Small end-to-end task

Use one representative repository and Markdown role instructions. Record the exact base revision, implementation revision, and revision each reviewer/QA agent checked. Do not let implementation mutate the code underneath a review and then treat the review as applying to the latest code.

Exercise one task that produces a genuine review finding, one fix, a re-review, QA evidence, and final human handoff. Reuse the same reviewer session and separately persist its findings. Also test an empty-finding round, a still-unfixed repeated finding, and a disagreement requiring operator judgment.

Pass evidence:

- No routine human intervention between approved planning and final handoff.
- Findings remain traceable through fixes and rechecks.
- Final evidence applies to the actual handed-off revision.
- Humans can request another cycle through the selected handoff channel.
- Bridle cannot merge through its tools or through the credentials available to coding agents.
- Task artifacts survive dev-box cleanup under the selected retention policy.

Do not require complete automatic crash recovery to pass the prototype. Do require honest status, no false approval/completion, explicit ambiguous outcomes, and a workable manual intervention path.

## After these experiments

Write the detailed architecture and implementation backlog around the validated path:

1. Infrastructure and trust boundaries.
2. Domain schemas and workspace/task identities.
3. Effect services and concrete Layers for inputs, task state, dev boxes, agents, artifacts, review access, and operator tools.
4. Default Markdown process and specialist roles.
5. Vertical implementation slices with tests and handoff criteria.
6. Deployment, operational limits, credential rotation, retention, and manual recovery documentation.

Until then, the research reports describe candidates and gaps, not a promise that the integrations already work together.
