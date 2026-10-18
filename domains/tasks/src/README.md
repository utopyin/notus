# Task state integration

`State` is exported from `@notus/tasks/state`. Supply `TaskDb.Service` and `State.Configuration` once per DO runtime. `State.layer` and `State.layerNoDeps` leave both requirements explicit. `State.configuration({ simulationDelayMs, claimTtlMs })` validates and supplies configuration.

The tables, relations and migrations belong to `@notus/db`; `TaskDb.layer` opens and migrates the object's database. `@notus/tasks/rows` decodes stored rows, including JSON columns, into the task's own types.

## Commands

- `admit(admission)` returns `{ taskId, inputId, duplicate }`. It uses the Effect clock for admission time. The initiating input must bootstrap the DO. Reservation ownership and source cannot change. Event-ID differences and monotonic start-intent upgrades do not create another input, invocation, reaction, or answer.
- `missingHandoffs(scheduledInputIds, limit)` returns admitted inputs without an execution handoff, with their task ID and original admission time. Control supplies IDs from Attempts.
- `missingResponses(resultIds, limit)` returns accepted result IDs without a complete response/outbox pair. Control supplies IDs from Attempts.
- `recordResponse(response, now)` records an accepted result handed over by Control and repairs a missing outbox row on replay. It does not accept execution observations itself.
- `claimDueDelivery(now)` returns one `DeliveryClaim` or `null`. The claim includes its durable target, source/input IDs, kind, text or `eyes` reaction, digest, claim UUID, generation, and recovery deadline. Claim immediately before sending; never preclaim a serial batch.
- `recordDeliveryOutcome(claim, outcome, now)` atomically records the fenced outcome and, for confirmed answers, fulfills the answer obligation. Identical outcome replays are no-ops; conflicting or superseded claims fail.
- `nextWake(now)` returns epoch milliseconds or `null` for pending deliveries and claim recovery. Control adds invocation deadlines and incomplete handoffs. Already-due work returns `now`.
- `snapshot` is an Effect that returns validated internal records, including pending obligations and ambiguous/rejected deliveries. It contains source addresses and message content, never stored provider credentials or executable handles. This is not a public endpoint.

All `now`, delay, deadline, and retry values use epoch milliseconds or millisecond durations, not Slack timestamps. The shared admission's provider stamps remain strings.

## Delivery outcomes

```ts
{ _tag: "Confirmed", receipt: "provider-reference" }
{ _tag: "RateLimited", retryAt: futureEpochMillis }
{ _tag: "Rejected", code: "safe-classification" }
{ _tag: "Ambiguous", code: "safe-classification" }
```

Control resolves each claim's target through Sources and translates its receipt/error into these values. No provider call occurs in State. Use safe codes, not raw HTTP bodies or credentials. `RateLimited` means a known provider rejection, never a guessed classification after a timeout. Retry times must be strictly later than the reporting call's `now`.

Expired answer claims become ambiguous and do not retry. Their answer obligations stay pending. Reactions are safe to repeat; expired or ambiguous reactions can retry, and unstarted reactions are skipped after final answer confirmation. A definite rejection remains visible without automatic retry. This slice has no manual reconciliation command.

## Transaction and ownership boundaries

Task mutations run in native Drizzle `transactionSync` callbacks. They contain only synchronous-compatible local Effects and query only task-owned tables. Attempts owns execution queries and atomic `ensure`, `schedule`, and `accept` operations. Control uses the replaceable `Attempts.Service` to schedule deterministic content, accept due observations, and hand accepted results to State. No domain reaches into another owner's transaction.

The application calls Control's `admit(admission, simulationDelayMs)`, `advance(now, simulationDelayMs)`, `acceptOutcome(observation, now)`, `nextWake(now)`, and `snapshot()`. The combined snapshot retains the original task and execution fields. A failure between owners leaves a committed, discoverable handoff. Replay repairs missing invocations and response/outbox pairs without rewriting persisted simulation content or deadlines. Each advance processes at most 16 rows per category. ID reconciliation currently scans the task's history; pagination is deferred for this first slice.

The application owns `blockConcurrencyWhile`, alarm ordering, migrations, and provider-call lifetimes. Arm a recovery wake before mutations, claim one delivery, leave the gate, send, then record its outcome and recompute the wake. An individual delivery failure does not stop subsequent sends. Alarm-level failures are logged and propagated as defects so Cloudflare can retry, including failure to arm the first recovery wake. A claim lease expiring never proves a provider request stopped.

The fixture's canonical initiator authorization and pre-start-message filtering belong to intake. State checks reservation consistency and immutability; it cannot resolve a provider actor into a canonical user itself. The stored origin attachment enables this slice's Slack receive, reaction, reply, and update capabilities; there is no generic attachment mutation API.

The deterministic content checksum is FNV-1a 64-bit, explicitly not a signature or security boundary. Outcome acceptance compares full content as well as the checksum. Version 1 persists `Simulation completed for input <id>. No coding agent was run.` with its original deadline and result ID.
