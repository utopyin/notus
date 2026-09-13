# Operator round trip

Authorized follow-up to [Slack devbox provisioning](provisioning.md). The user chose a control-plane operator: the loop runs in the Task Durable Object, devbox state is part of the prompt, and devbox-touching tools must ensure the box exists and is awake. This document records the implemented increment and its gates; [product context](../../CONTEXT.md) owns behavior and the [codebase plan](codebase.md) owns ownership.

## Scope

An admitted human input in an `operator` task becomes one invocation with a sequence of persisted steps. Each step is one bounded model round performed outside the object's concurrency gate, using the initiator's saved ChatGPT subscription login through that user's Connection object. The final text becomes the accepted outcome, response and thread answer through the existing outbox. Existing simulation and readiness tasks keep their persisted mode.

This increment offers the model no tools, provisions no devbox, and reaches no repository. The prompt states that plainly. Follow-up messages in the thread are new turns whose prompt contains the earlier questions and answers.

## Ownership

- `@notus/openai` (tier 1): Codex public-client refresh, the subscription-backend forward with an exact URL, method, content-type and size allowlist, the neutral `LanguageModel` layer over a caller-supplied `HttpClient`, and the wire shapes a broker exchanges. It never reads storage.
- `accounts/connections` (tier 2): one saved login per canonical user; explicit link, status, revoke and `forward`. Refresh runs within five minutes of expiry, under the host gate, and persists the rotated pair before the new access token is used. Definitive provider answers are recorded by operation ID and replayed without a second provider call; pacing and transport failures are not recorded.
- `executions/steps` (tier 2): sequential steps per invocation with leases, attempts, retry deadlines, encoded response parts, final text and failure classification. Bounds: a 150-second lease, six attempts per step, eight steps per turn.
- `entrypoints/operator` (tier 3): the briefing shape, prompt construction, one model round returning replayable parts, and the retry classification of model failures.
- `control/operator` (tier 3): schedule invocations and first steps for admitted inputs, claim a step with its briefing, record outcomes, settle finished or failed turns into accepted outcomes, and compute the next wake. A failed turn still answers, naming the reason, so the answer obligation is never silently dropped.
- `apps/api`: the Connection Durable Object host, the broker `HttpClient` whose only transport is the Connection object, the operator branches of the Task object, and the `NOTUS_MODEL` and `NOTUS_FIXTURE_CHATGPT_OAUTH` configuration.

## Authority and credentials

The initiator recorded in the task reservation selects the connection; later thread participants never change it. Model requests leave the Task object without credentials; the Connection object adds the bearer and account header for exactly one provider endpoint and returns the provider's response. Connection failures reach the model client as ordinary HTTP statuses, so missing, revoked or unrefreshable logins end the turn as authentication failures without a provider call, and rate limits are retried at the provider's hint.

Linking is explicit. The only link path today is the deployment secret `NOTUS_FIXTURE_CHATGPT_OAUTH`, a login produced by `bun run login:chatgpt` and placed there by the administrator for the fixture user. The Connection object imports it once, only while unlinked, and remembers the seed fingerprint; revoking blocks the same seed from relinking. Tokens are stored in the object's SQLite under Cloudflare storage encryption; application-level envelope encryption and user-driven account linking are later increments.

The Codex public client is not an independently registered application client and the subscription backend is not a documented API. The user accepted running the test under their own ChatGPT account. Confirm the applicable provider terms independently of technical success; never add an API-key fallback.

## Validation

Native workerd checks executed the actual Worker, Task and Connection objects with fake model, token and Slack endpoints: a mention answered by the model text, refresh of an expired seed before the first forward, request headers and stateless body settings, status without token material, per-user object isolation, operation replay without a second call, a follow-up turn carrying thread history, a 429 retried once on the same operation, revocation blocking both forwarding and reseeding while still answering, fulfilled obligations, a quiescent alarm, mode persistence across restart, and zero unexpected outbound requests. The earlier readiness and simulation checks were rerun unchanged. Evidence is machine-local under `/tmp/notus-operator-host/REPORT.md` and `/tmp/notus-regression-host/run1.log`; no repository test files were added.

Not yet validated: the subscription backend's real response shape and model availability, live refresh, live Slack delivery, and a Cloudflare deployment with the new Connection class. Enablement needs `NOTUS_MODE=operator` and the fixture login secret in the test stage, deployed with `--force` because Alchemy's plan does not detect secret-backed changes.

## Next increments

1. Devbox tools: `ensure_devbox` reusing the readiness machinery, with the tool result delivered as a step observation after the readiness callback, and the prompt already reporting whether a box exists.
2. Specialist rounds on the box through the outbound callback channel, with results as accepted evidence.
3. User-driven account linking and application-level encryption of stored connections.
