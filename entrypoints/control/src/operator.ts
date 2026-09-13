import type { Admission } from "@notus/contracts/source";
import { Attempts } from "@notus/executions/attempts";
import { Provisioning } from "@notus/executions/provisioning";
import { Steps, type StepClaim, type StepOutcome } from "@notus/executions/steps";
import { digest } from "@notus/executions/types";
import { Operator } from "@notus/operator/operator";
import { Briefing, type Message } from "@notus/operator/types";
import { State } from "@notus/tasks/state";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
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

export const admit = Effect.fn("OperatorControl.admit")(function* (command: Admission) {
  const state = yield* State.Service;
  const receipt = yield* state.admit(command);
  yield* schedule(yield* Clock.currentTimeMillis);
  return receipt;
});

/** Local-only repair. Model calls happen outside the host gate through claim/record. */
export const advance = Effect.fn("OperatorControl.advance")(function* (now: number) {
  return (yield* schedule(now)) + (yield* settle(now));
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
  const times = [yield* state.nextWake(now), yield* steps.nextWake].filter(
    (at): at is number => at !== null,
  );
  return times.length === 0 ? null : Math.max(now, Math.min(...times));
});
