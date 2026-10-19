# Task state

`State` is exported from `@notus/tasks/state`. Supply `TaskDb.Service` and `State.Configuration` once per Task object runtime; `State.configuration(settings)` validates and supplies the configuration. Tables and migrations belong to `@notus/db`; `@notus/tasks/rows` decodes stored rows into the task's own types.

## Commands

- `admit(admission)` records an input and returns `{ taskId, inputId, duplicate }`. The initiating input bootstraps the object; replays do not create another input, reaction or answer.
- `attach(source, now)` attaches another conversation, such as the task's pull request.
- `missingHandoffs` and `missingResponses` list admitted inputs without an execution handoff and accepted results without a response, so Control can repair a failure between owners.
- `recordResponse(response, now)` records an accepted result and its outbox row.
- `claimDueDelivery(now)` claims one outbox row; `recordDeliveryOutcome(claim, outcome, now)` records the fenced outcome and, for a confirmed answer, fulfills the answer obligation.
- `nextWake(now)` returns the next epoch millisecond the object must wake for deliveries and claim recovery, or `null`.
- `snapshot` returns the validated internal records. It is not a public endpoint.

Times are epoch milliseconds.

## Delivery outcomes

```ts
{ _tag: "Confirmed", receipt: "provider-reference" }
{ _tag: "RateLimited", retryAt: futureEpochMillis }
{ _tag: "Rejected", code: "safe-classification" }
{ _tag: "Ambiguous", code: "safe-classification" }
```

Control resolves each claim's target through the platform registry and translates the provider result into these values; State makes no provider call. An expired answer claim becomes ambiguous and is not retried, so its obligation stays pending. Reactions are safe to repeat.

## Boundaries

Mutations run in synchronous Drizzle transactions over task-owned tables only. Execution records belong to `@notus/executions`; no domain reaches into another owner's transaction. The host owns `blockConcurrencyWhile`, alarm ordering and provider-call lifetimes: claim one delivery under the gate, send outside it, then record the outcome.
