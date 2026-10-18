import { Activity } from "@notus/executions/activity";
import { Commands } from "@notus/executions/commands";
import { Devbox } from "@notus/executions/devbox";
import { Provisioning } from "@notus/executions/provisioning";
import type { StepOutcome } from "@notus/executions/steps";
import { Operator } from "@notus/operator/operator";
import { State } from "@notus/tasks/state";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Actions } from "./actions";
import * as Broker from "./broker";
import type { DeploymentConfig } from "./config";
import { Durable } from "./objects/durable";
import { OperatorControl } from "./operator";
import { ReadinessControl } from "./provisioning";
import { Control } from "./task";

/**
 * A task's alarm: it drives provisioning, model rounds, control actions and deliveries. Each step
 * runs under the object's gate and every provider call outside it; the alarm is re-armed before
 * any work, so a lost isolate wakes the task again.
 */
const make = (settings: DeploymentConfig) =>
  Effect.gen(function* () {
    const durable = yield* Durable.Service;
    const state = yield* State.Service;
    const provisioning = yield* Provisioning.Service;
    const devbox = yield* Devbox.Service;
    const activity = yield* Activity.Service;
    const commands = yield* Commands.Service;
    // Each model request selects its operation at call time.
    const model = yield* LanguageModel.LanguageModel;
    const control = yield* Control.Service;
    const operator = yield* OperatorControl.Service;
    const readiness = yield* ReadinessControl.Service;
    const actions = yield* Actions.Service;

    const gate = durable.gate;

    const mode = state.snapshot.pipe(
      Effect.map((snapshot) => snapshot.task?.mode ?? settings.mode),
    );

    /** One step of the task's own state machine, under the gate. */
    const advance = Effect.fn("Alarm.advance")(function* (now: number) {
      const selected = yield* mode;

      if (selected === "readiness") return yield* readiness.advance(now);
      if (selected === "operator") return yield* operator.advance(now);
      return yield* control.advance(now, settings.simulationDelayMs);
    });

    /** Wakes the object by `at` at the latest. */
    const arm = Effect.fn("Alarm.arm")(function* (at: number) {
      const existing = yield* durable.alarm;
      if (existing === null || existing > at) yield* durable.setAlarm(at);
    });

    /** Sets the alarm to the task's next wake, or clears it when nothing is due. */
    const recompute = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const selected = yield* mode;
      const next =
        selected === "readiness"
          ? yield* readiness.nextWake(now)
          : selected === "operator"
            ? yield* operator.nextWake(now)
            : yield* control.nextWake(now);

      // A working box's hold is renewed by this alarm too.
      const held = selected === "operator" ? yield* activity.nextWake(now) : null;
      const at = next === null ? held : held === null ? next : Math.min(next, held);

      if (at === null) yield* durable.deleteAlarm;
      else yield* durable.setAlarm(Math.max(now + 1, at));
    });

    const provision = Effect.gen(function* () {
      for (let index = 0; index < 2; index++) {
        const claim = yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* arm(now + 30_000);
            return yield* provisioning.claim(now);
          }),
        );
        if (!claim) break;

        yield* Effect.gen(function* () {
          const result = yield* devbox.perform(claim);
          yield* Effect.logInfo(`task.provisioning ${claim.work} -> ${result._tag}`);

          yield* gate(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;

              yield* arm(now + 1);
              yield* provisioning.record(claim, result, now);
              yield* advance(now);
              yield* recompute;
            }),
          );
        }).pipe(Effect.catchCause(() => Effect.logError("task.provisioning_failed")));
      }
    });

    const rounds = Effect.gen(function* () {
      for (let index = 0; index < 4; index++) {
        const claimed = yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            // Cover the step lease so a lost isolate re-offers the step.
            yield* arm(now + 150_000);
            return yield* operator.claim(now);
          }),
        );
        if (!claimed) break;

        // The model round runs outside the gate.
        const outcome = yield* Operator.run(claimed.briefing, claimed.step.priorParts).pipe(
          Effect.provideService(LanguageModel.LanguageModel, model),
          Effect.provideService(Broker.Operation, {
            userId: claimed.briefing.initiatorId,
            operationId: claimed.step.operationId,
          }),
          Effect.map((result): StepOutcome => ({
            _tag: "Completed",
            parts: result.parts,
            text: result.text,
            calls: result.calls,
            final: result.final,
          })),
          Effect.catch((error) =>
            Effect.gen(function* () {
              // Provider descriptions carry status and error code; headers are redacted.
              yield* Effect.logWarning(
                `task.operator_step_failed ${error.cause._tag}: ${error.message.slice(0, 500)}`,
              );

              const now = yield* Clock.currentTimeMillis;
              return Operator.classify(error, claimed.step.attempts, now) as StepOutcome;
            }),
          ),
        );

        yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            yield* arm(now + 1);
            yield* operator.record(claimed.step, outcome, now);
            yield* recompute;
          }),
        ).pipe(Effect.catchCause(() => Effect.logError("task.operator_record_failed")));
      }
    });

    const hold = Effect.gen(function* () {
      const due = yield* gate(
        Effect.gen(function* () {
          return yield* activity.due(yield* Clock.currentTimeMillis);
        }),
      );

      // Provider call outside the gate; a lost hold runs out by itself.
      if (due !== null) yield* activity.perform(due, yield* Clock.currentTimeMillis);
    }).pipe(Effect.catchCause(() => Effect.logError("task.activity_failed")));

    const retire = Effect.gen(function* () {
      // A replaced attempt's box is ended at the provider, outside the gate.
      const [retiring] = yield* gate(provisioning.retirements);
      if (retiring === undefined) return;

      const ended = yield* devbox.end(retiring.environment, retiring.resource).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );

      yield* Effect.logInfo(`task.retire ${retiring.resource.id} ended=${ended}`);

      yield* gate(
        Effect.gen(function* () {
          yield* provisioning.retired(retiring.attemptId, ended, yield* Clock.currentTimeMillis);
        }),
      );
    }).pipe(Effect.catchCause(() => Effect.logError("task.retire_failed")));

    const act = Effect.gen(function* () {
      for (let index = 0; index < 2; index++) {
        const claimed = yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            yield* arm(now + 60_000);
            const command = yield* commands.claimControl(now);

            return command ? { command, claimedAt: now } : null;
          }),
        );
        if (!claimed) break;

        const spec = claimed.command.spec;

        if (spec.kind !== "pull-request" && spec.kind !== "update") break;

        // Provider call outside the gate; the lease fences a lost isolate.
        const result = yield* actions.perform({ id: claimed.command.id, spec });

        yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            yield* arm(now + 1);
            yield* commands.complete(claimed.command.id, claimed.claimedAt, result, now);
            yield* advance(now);
            yield* recompute;
          }),
        ).pipe(Effect.catchCause(() => Effect.logError("task.control_action_failed")));
      }
    });

    const deliver = Effect.gen(function* () {
      const counts = { claimed: 0, confirmed: 0, rateLimited: 0, rejected: 0, ambiguous: 0 };

      for (let index = 0; index < 16; index++) {
        const claim = yield* gate(
          Effect.gen(function* () {
            // Arm before claiming, including after a slow previous send.
            yield* arm((yield* Clock.currentTimeMillis) + settings.claimTtlMs);
            return yield* control.claim();
          }),
        );
        if (claim === null) break;

        counts.claimed++;

        yield* Effect.gen(function* () {
          // Network work stays outside the local gate.
          const outcome = yield* control.deliver(claim);

          yield* gate(
            Effect.gen(function* () {
              yield* arm((yield* Clock.currentTimeMillis) + 1);
              yield* state.recordDeliveryOutcome(claim, outcome, yield* Clock.currentTimeMillis);
              yield* recompute;
            }),
          );

          switch (outcome._tag) {
            case "Confirmed":
              counts.confirmed++;
              break;
            case "RateLimited":
              counts.rateLimited++;
              break;
            case "Rejected":
              counts.rejected++;
              break;
            case "Ambiguous":
              counts.ambiguous++;
              break;
          }
        }).pipe(
          Effect.catchCause(() =>
            Effect.logError("task.delivery_failed", { deliveryId: claim.deliveryId }),
          ),
        );
      }

      return counts;
    });

    const run = Effect.gen(function* () {
      yield* gate(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          // The alarm currently firing no longer counts as a recovery wake.
          yield* durable.setAlarm(now + settings.claimTtlMs);
          yield* advance(now);
        }),
      );

      // Readiness tasks always provision; operator tasks provision once the operator asked.
      if ((yield* mode) !== "simulation") yield* provision;

      if ((yield* mode) === "operator") yield* rounds;

      if ((yield* mode) === "operator") {
        yield* hold;
        yield* retire;
        yield* act;
      }

      const counts = yield* deliver;

      // Even an empty scan must account for concurrent admission and all
      // outstanding sending claims before deleting the alarm.
      yield* gate(recompute);
      yield* Effect.logInfo("task.drain", counts);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("task.drain_failed", Cause.pretty(cause)).pipe(
          Effect.andThen(Effect.failCause(cause)),
        ),
      ),
      // A defect rejects the alarm, which the platform retries.
      Effect.orDie,
    );

    return { mode, advance, arm, recompute, run };
  });

export class Service extends Context.Service<Service>()("@notus/control/Alarm", { make }) {}

export const layer = (settings: DeploymentConfig) => Layer.effect(Service, Service.make(settings));

export * as Alarm from "./alarm";
