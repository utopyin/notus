import type { Admission } from "@notus/contracts/source";
import { Attempts } from "@notus/executions/attempts";
import { Provisioning } from "@notus/executions/provisioning";
import { Steps, type StepClaim, type StepOutcome } from "@notus/executions/steps";
import { digest, type ProvisioningStatus } from "@notus/executions/types";
import { Operator } from "@notus/operator/operator";
import { DevboxResult } from "@notus/operator/tools";
import { Briefing, type Message } from "@notus/operator/types";
import { State } from "@notus/tasks/state";
import type { Environment } from "@notus/workspaces/types";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { acceptOutcome } from "./task";

const batchSize = 16;

/** Every admitted human input gets exactly one operator invocation and its first step. */
const schedule = Effect.fn("OperatorControl.schedule")(function* (now: number) {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const missing = yield* state.missingHandoffs(yield* attempts.scheduledInputIds, batchSize);
  for (const input of missing) {
    const attempt = yield* attempts.ensure(input.taskId, now, "operator");
    // Operator invocations carry no predetermined content; the accepted outcome does.
    const invocation = yield* attempts.schedule(attempt, input.inputId, now, "");
    yield* steps.ensure(invocation.id, now);
  }
  // A crash between scheduling and the first step must not strand the turn.
  const execution = yield* attempts.snapshot;
  for (const invocation of execution.invocations)
    if (invocation.status === "pending") yield* steps.ensure(invocation.id, now);
  return missing.length;
});

const fallback = (failure: string) =>
  `I could not answer this message because ${Operator.explain(failure)}. Nothing else was run.`;

/** Settled turns become accepted outcomes; every human input still receives a final answer. */
const settle = Effect.fn("OperatorControl.settle")(function* (now: number) {
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const state = yield* State.Service;
  const settled = yield* steps.settled(batchSize);
  const execution = yield* attempts.snapshot;
  const outcomes = new Map(execution.outcomes.map((row) => [row.invocationId, row]));
  let count = 0;
  for (const entry of settled) {
    if (outcomes.has(entry.invocationId)) continue;
    const invocation = execution.invocations.find((row) => row.id === entry.invocationId);
    if (!invocation) continue;
    const content =
      entry.result._tag === "Final"
        ? entry.result.text.trim() || "I have nothing to add to this message."
        : fallback(entry.result.failure);
    yield* acceptOutcome(
      {
        operationId: invocation.operationId,
        attemptId: invocation.attemptId,
        generation: invocation.generation,
        invocationId: invocation.id,
        inputId: invocation.inputId,
        resultId: invocation.resultId,
        content,
        digest: digest(content),
      },
      now,
    );
    count++;
  }
  // Repair an accepted outcome whose response write was lost.
  const missing = new Set(
    yield* state.missingResponses(
      execution.outcomes.map((row) => row.id),
      batchSize,
    ),
  );
  for (const outcome of execution.outcomes)
    if (missing.has(outcome.id)) {
      yield* acceptOutcome(outcome.observation, now);
      count++;
    }
  return count;
});

/** Capture the workspace environment once, before the operator decides anything about a box. */
export const prepare = Effect.fn("OperatorControl.prepare")(function* (
  environment: Environment | null,
  now: number,
) {
  const provisioning = yield* Provisioning.Service;
  yield* provisioning.capture(environment, now);
});

const describe = (status: ProvisioningStatus): DevboxResult => {
  const ready = status.phase === "ready";
  return {
    phase: status.phase,
    ready,
    resourceId: status.resourceId,
    blockedReason: status.blockedReason,
    message: ready
      ? "The dev box is provisioned and its runtime reported ready. No repository, shell or command access exists yet."
      : `Provisioning stopped in phase ${status.phase}${status.blockedReason ? ` (${status.blockedReason})` : ""}. No dev box is usable.`,
  };
};
const encodeResult = Schema.encodeEffect(DevboxResult);

/** Start durable work for unresolved tool calls. Idempotent: provisioning binds once per attempt. */
const dispatch = Effect.fn("OperatorControl.dispatch")(function* (now: number) {
  const steps = yield* Steps.Service;
  const provisioning = yield* Provisioning.Service;
  const state = yield* State.Service;
  const waiting = yield* steps.waiting(batchSize);
  if (waiting.length === 0) return;
  const task = (yield* state.snapshot).task;
  if (!task) return;
  for (const step of waiting)
    for (const call of step.calls) {
      if (call.name !== "create_devbox") continue;
      if ((yield* provisioning.current) !== null) continue;
      const environment = yield* provisioning.captured;
      yield* provisioning.initialize(
        { taskId: task.id, workspaceId: task.reservation.workspaceId, environment },
        now,
      );
    }
});

/** Resolve waiting steps whose provider work has settled; unknown tools fail immediately. */
const resolveWaits = Effect.fn("OperatorControl.resolveWaits")(function* (now: number) {
  const steps = yield* Steps.Service;
  const provisioning = yield* Provisioning.Service;
  let count = 0;
  for (const step of yield* steps.waiting(batchSize)) {
    const results: Array<Schema.Json> = [];
    let pending = false;
    for (const call of step.calls) {
      if (call.name !== "create_devbox") {
        results.push(Operator.toolResult(call, { error: `unknown tool ${call.name}` }, true));
        continue;
      }
      const status = yield* provisioning.current;
      const settled =
        status !== null &&
        status.pendingWork === null &&
        (status.phase === "ready" || status.phase === "blocked");
      if (!settled) {
        pending = true;
        continue;
      }
      const encoded = yield* encodeResult(describe(status));
      results.push(Operator.toolResult(call, encoded, status.phase !== "ready"));
    }
    if (pending) continue;
    yield* steps.resolve(step.id, results, now);
    count++;
  }
  return count;
});

export const admit = Effect.fn("OperatorControl.admit")(function* (command: Admission) {
  const state = yield* State.Service;
  const receipt = yield* state.admit(command);
  yield* schedule(yield* Clock.currentTimeMillis);
  return receipt;
});

/** Local-only repair. Model calls happen outside the host gate through claim/record. */
export const advance = Effect.fn("OperatorControl.advance")(function* (now: number) {
  const scheduled = yield* schedule(now);
  yield* dispatch(now);
  const resolved = yield* resolveWaits(now);
  return scheduled + resolved + (yield* settle(now));
});

export interface Claimed {
  readonly step: StepClaim;
  readonly briefing: Briefing;
}

const brief = Effect.fn("OperatorControl.brief")(function* (invocationId: string) {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const provisioning = yield* Provisioning.Service;
  const snapshot = yield* state.snapshot;
  const execution = yield* attempts.snapshot;
  const invocation = execution.invocations.find((row) => row.id === invocationId);
  const task = snapshot.task;
  const current = snapshot.inputs.find((row) => row.id === invocation?.inputId);
  if (!task || !invocation || !current) return null;
  const inputs = new Map(snapshot.inputs.map((row) => [row.id, row]));
  const history: Array<Message> = [];
  for (const row of snapshot.inputs) {
    if (row.id === current.id || row.createdAt > current.createdAt) continue;
    history.push({
      role: "user",
      actor: row.input.actor.externalId,
      text: row.input.text,
      at: row.createdAt,
    });
  }
  for (const row of snapshot.responses) {
    const input = inputs.get(row.inputId);
    if (!row.final || !input || input.createdAt > current.createdAt || row.inputId === current.id)
      continue;
    history.push({ role: "assistant", actor: null, text: row.text, at: row.createdAt });
  }
  history.sort((left, right) => left.at - right.at);
  const devbox = yield* provisioning.current;
  return Briefing.make({
    taskId: task.id,
    initiatorId: task.reservation.initiatorId,
    devbox: devbox
      ? { phase: devbox.phase, resourceId: devbox.resourceId, lastReadyAt: devbox.lastReadyAt }
      : null,
    history,
    current: {
      role: "user",
      actor: current.input.actor.externalId,
      text: current.input.text,
      at: current.createdAt,
    },
  });
});

export const claim = Effect.fn("OperatorControl.claim")(function* (now: number) {
  const steps = yield* Steps.Service;
  const step = yield* steps.claim(now);
  if (!step) return null;
  const briefing = yield* brief(step.invocationId);
  if (!briefing) {
    // Inconsistent local state: fail the step rather than call a model blindly.
    yield* steps.record(step, { _tag: "Failed", failure: "missing-briefing" }, now);
    yield* settle(now);
    return null;
  }
  return { step, briefing } satisfies Claimed;
});

export const record = Effect.fn("OperatorControl.record")(function* (
  claimed: StepClaim,
  outcome: StepOutcome,
  now: number,
) {
  const steps = yield* Steps.Service;
  yield* steps.record(claimed, outcome, now);
  yield* settle(now);
});

export const nextWake = Effect.fn("OperatorControl.nextWake")(function* (now: number) {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const provisioning = yield* Provisioning.Service;
  const waiting = yield* steps.waiting(batchSize);
  if (waiting.length > 0) {
    const status = yield* provisioning.current;
    if (
      waiting.some((step) => step.calls.some((call) => call.name !== "create_devbox")) ||
      status === null ||
      (status.pendingWork === null && (status.phase === "ready" || status.phase === "blocked"))
    )
      return now;
  }
  if ((yield* state.missingHandoffs(yield* attempts.scheduledInputIds, 1)).length > 0) return now;
  const execution = yield* attempts.snapshot;
  const accepted = new Set(execution.outcomes.map((row) => row.invocationId));
  if ((yield* steps.settled(batchSize)).some((row) => !accepted.has(row.invocationId))) return now;
  if (
    (yield* state.missingResponses(
      execution.outcomes.map((row) => row.id),
      1,
    )).length > 0
  )
    return now;
  const times = [
    yield* state.nextWake(now),
    yield* steps.nextWake,
    waiting.length > 0 ? yield* provisioning.nextWake : null,
  ].filter((at): at is number => at !== null);
  return times.length === 0 ? null : Math.max(now, Math.min(...times));
});
