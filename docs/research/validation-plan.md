# Integration validation plan

Proposed experiments; none has run. This is not deployment permission. [Provider notes](README.md) own evidence, [product context](../../CONTEXT.md) owns product decisions, and [the codebase proposal](../plans/codebase.md) owns responsibilities.

Use fixtures outside read-only `repos/`, then explicitly authorized accounts/resources with spend limits and cleanup ownership. Record package/runtime versions, image digests, Worker compatibility date, observations, failures, and cleanup without secrets. Technical success does not establish provider permission or billing entitlement.

## 1. Package and host compatibility

References: [sources](sources.md), [Effect](effect-v4.md), [Alchemy](alchemy.md).

- Select reproducible normal dependencies or separately built artifacts. Resolve Herdr's Effect mismatch, Namespace distribution/license gaps, and transitive Node engine requirements.
- Compile and exercise minimal model/tool/HTTP services on each intended host. Build the actual Alchemy Worker, including Distilled; check import closures and transport behavior, not only types.

Pass: reproducible host-compatible artifacts without forced compatibility casts or runtime imports from `repos/`.

## 2. Model access and credential lifecycle

Reference: [OpenAI](openai-auth.md). Start with the verified Erudane configuration pattern and fake HTTP/model fixtures. Confirm support for the intended OAuth client, user-owned shared-workflow identity, and billing mode before relying on live access. Codex/MCP is an alternative if necessary.

- Exercise required text, tools/results, structured output, streams, reasoning/phase continuity, errors, and cancellation on the chosen backend. Test specialist authentication separately from the operator.
- Cross expiry with concurrent consumers and restart during refresh. Verify atomic rotated-token persistence, retryable failure versus reconnect-required, revocation, usage attribution, and no API-key fallback. Inject quota failure rather than exhausting a subscription.
- Use synthetic secrets to check isolation from repository processes, tools, environment, logs/traces, histories, and artifacts.

Pass: required model behavior works, authorized consumers share safe renewal, and failures do not leak credentials or change billing. Record provider-support assumptions separately.

## 3. Namespace control and bootstrap

Reference: [Namespace](namespace.md). Compare a supported fetch/descriptor lifecycle subset with a trusted Node SDK/CLI adapter before selecting topology.

- Create/fetch/activate/stop/delete one pinned-image box; drop responses and reconcile the assignment without duplicate allocation. Confirm private API support and actual grants.
- Signal supervisor readiness only after repository/ref checkout, tools, and task credentials are ready. Verify unattended startup, restricted clone/push/PR access, and independence from the provisioner's connection.
- Cross idle/token expiry; exercise task-marker cleanup, stop/start persistence, runtime/retention caps, and lost-owner cleanup. Run representative build/browser QA under actual resource and egress limits.

Pass: an authorized control path boots usable isolated work, reconciles uncertain outcomes, and has bounded lifetime/cleanup cost. Process restoration must not be confused with preserved execution.

## 4. Sessions, results, and hours-long waits

Reference: [Herdr](herdr.md). Start with a simulated slow worker, then one harmless agent invocation.

- Check readiness separately from launch acknowledgement. Cover old done-state, blocked dialogs, echoed sentinels, stale files, lost prompt responses, and invocation/revision-tagged result validation.
- Detach/reconnect and request cancellation separately. Reconcile snapshots/results without duplicate prompting. Reuse a native session for two rounds; check what unattended restart actually restores.
- Hold a tool wait for at least two hours, including a transport interruption, and count operator model calls. Bound concurrency and consume each completion once. If a held call is unsafe, validate recorded wait intent plus same-thread event-driven resume.

Pass: zero model calls while waiting, no stale result completing new work, explicit cancellation/unknown outcomes, and caught failures reaching intervention. Full automatic crash recovery is not required.

## 5. Trusted public plan review

References: [Plannotator](plannotator.md), [Namespace ingress](namespace.md#review-ingress-and-qa). Use the strict direct gate, immutable Markdown, private backend, and a browser without Namespace login.

- Exercise positive, negative, dismissed, malformed, missing-assets, process-loss, and partial-result-publication paths. Only gateway-attested acceptance of exact bytes may approve; local endpoints/files must not forge it.
- Validate capability scope, expiry/revocation, concurrent decisions, CSRF/Host/Origin checks, route allowlists, streams, and direct-backend bypass. Preview GETs must not approve. Review access must not expose filesystem/terminal/operator controls.
- Exercise proxy loss, restart, concurrent gates, and port reuse. Old links cannot authorize a replacement revision/process. Confirm the planner returns approved Markdown and stops before implementation.

Pass: anonymous valid-link review works, failures never approve, one accepted result binds exact bytes, and unrelated access is denied. Missing private ingress/relay or process isolation blocks this path.

## 6. Control persistence and Slack

References: [Cloudflare](cloudflare.md), [Slack](slack.md). Begin with fake delivery, then deploy one task DO and an inbound hibernatable devbox socket through Alchemy.

- Verify signatures, timestamp/identity mapping, filtering, scopes, thread replies, and prompt acknowledgement after durable admission. Replay events before/after task creation and retain the same task/operation.
- Hibernate/reconstruct/redeploy and reconnect with cursors. Preserve replies, findings, decisions, and pending delivery; reject stale/wrong-workspace credentials. Exercise actual SQLite transactions and concurrency.
- Lose an outbound acknowledgement after send. Record delivery ambiguity rather than claiming exactly-once external effects. Check bounded messages, streaming/abort behavior, and no long-lived model wait in the DO.

Pass: admitted work survives reconstruction without duplicate allocation, authority remains scoped, and delivery returns to the origin thread.

## 7. Dispatch and one complete task

Reference: [Effect](effect-v4.md). First inject failures around intent, side effect, result, and chat-history persistence. Compare journaled automatic resolution with manual dispatch; no uncertain effect may replay blindly.

Then run finding → fix → re-review → QA → human handoff, including empty/repeated findings, disagreement, and another human-requested cycle. Evidence must identify the code revision it covers. Demonstrate the no-merge credential boundary, export accepted artifacts, delete the box, and read the evidence back independently.

Pass: findings/evidence outlive sessions and boxes, the model still chooses workflow actions, human boundaries hold, and ambiguous outcomes can reach manual intervention. Use measured results to finalize infrastructure and service contracts.
