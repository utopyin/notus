import type { Admission } from "@notus/platform/source";
import { Attempts } from "@notus/executions/attempts";
import type { Outcome } from "@notus/executions/rows";
import type { Observation } from "@notus/executions/types";
import { Platforms } from "@notus/platforms/registry";
import { State } from "@notus/tasks/state";
import type { DeliveryClaim, DeliveryOutcome } from "@notus/tasks/types";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const batchSize = 16;

const make = Effect.gen(function* () {
  const platforms = yield* Platforms.Service;
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;

  /** Provider work only. */
  const deliver = Effect.fn("Control.deliver")(function* (
    claim: DeliveryClaim,
  ): Effect.fn.Return<DeliveryOutcome> {
    return yield* Effect.gen(function* () {
      const port = yield* platforms.forInstallation(claim.target.source);
      const handle = yield* port.conversations.resolveReply(claim.target);

      if (claim.kind === "answer" && claim.text === null) {
        return { _tag: "Rejected", code: "missing_answer" } as const;
      }

      const receipt = yield* claim.kind === "reaction"
        ? handle.react(claim.deliveryId)
        : handle.reply(claim.text ?? "", claim.deliveryId);

      return { _tag: "Confirmed", receipt: receipt.reference } as const;
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          // An unregistered platform or unknown installation is a rejection like any other.
          if (error._tag !== "Sources.SourceError")
            return { _tag: "Rejected", code: "provider_rejected" } as const;

          switch (error.classification) {
            case "rate-limited":
              return {
                _tag: "RateLimited",
                retryAt: (yield* Clock.currentTimeMillis) + Math.max(1, error.retryAfter ?? 60_000),
              } as const;
            case "ambiguous":
              return { _tag: "Ambiguous", code: "provider_ambiguous" } as const;
            default:
              return { _tag: "Rejected", code: "provider_rejected" } as const;
          }
        }),
      ),
    );
  });

  const record = Effect.fn("Control.record")(function* (outcome: Outcome, now: number) {
    return yield* state.recordResponse(
      {
        id: outcome.id,
        inputId: outcome.observation.inputId,
        content: outcome.observation.content,
        digest: outcome.observation.digest,
        acceptedAt: outcome.acceptedAt,
      },
      now,
    );
  });

  const acceptOutcome = Effect.fn("Control.acceptOutcome")(function* (
    observation: Observation,
    now: number,
  ) {
    return yield* record(yield* attempts.accept(observation, now), now);
  });

  const schedule = Effect.fn("Control.schedule")(function* (
    now: number,
    simulationDelayMs: number,
  ) {
    const missing = yield* state.missingHandoffs(yield* attempts.scheduledInputIds, batchSize);

    for (const input of missing) {
      const attempt = yield* attempts.ensure(input.taskId, now, "simulation");
      yield* attempts.schedule(
        attempt,
        input.inputId,
        input.createdAt + simulationDelayMs,
        `Simulation completed for input ${input.inputId}. No coding agent was run.`,
      );
    }

    return missing.length;
  });

  /** Each committed handoff is discoverable if the following owner's write fails. */
  const admit = Effect.fn("Control.admit")(function* (
    command: Admission,
    simulationDelayMs: number,
  ) {
    const receipt = yield* state.admit(command);

    yield* schedule(yield* Clock.currentTimeMillis, simulationDelayMs);

    return receipt;
  });

  const advance = Effect.fn("Control.advance")(function* (now: number, simulationDelayMs: number) {
    const scheduled = yield* schedule(now, simulationDelayMs);
    const accepted = yield* attempts.accepted;

    const missing = new Set(
      yield* state.missingResponses(
        accepted.map((row) => row.id),
        batchSize,
      ),
    );

    for (const outcome of accepted) if (missing.has(outcome.id)) yield* record(outcome, now);
    const due = yield* attempts.due(now, batchSize);

    for (const invocation of due) {
      yield* acceptOutcome(
        {
          operationId: invocation.operationId,
          attemptId: invocation.attemptId,
          generation: invocation.generation,
          invocationId: invocation.id,
          inputId: invocation.inputId,
          resultId: invocation.resultId,
          content: invocation.content,
          digest: invocation.digest,
        },
        now,
      );
    }

    return scheduled + missing.size + due.length;
  });

  const nextWake = Effect.fn("Control.nextWake")(function* (now: number) {
    if ((yield* state.missingHandoffs(yield* attempts.scheduledInputIds, 1)).length > 0) return now;

    if (
      (yield* state.missingResponses(
        (yield* attempts.accepted).map((row) => row.id),
        1,
      )).length > 0
    )
      return now;

    const times = [yield* state.nextWake(now), yield* attempts.nextWake].filter(
      (at): at is number => at !== null,
    );

    return times.length === 0 ? null : Math.max(now, Math.min(...times));
  });

  const snapshot = Effect.fn("Control.snapshot")(function* () {
    const task = yield* state.snapshot;
    const execution = yield* attempts.snapshot;

    return {
      task: task.task,
      sources: task.sources,
      inputs: task.inputs,
      events: task.events,
      responses: task.responses,
      deliveries: task.deliveries,
      attempts: execution.attempts,
      invocations: execution.invocations,
      outcomes: execution.outcomes,
    };
  });

  const claim = Effect.fn("Control.claim")(function* () {
    return yield* state.claimDueDelivery(yield* Clock.currentTimeMillis);
  });

  return { deliver, acceptOutcome, admit, advance, nextWake, snapshot, claim };
});

export class Service extends Context.Service<Service>()("@notus/control/Task", { make }) {}

export const layer = Layer.effect(Service, Service.make);

export * as Control from "./task";
