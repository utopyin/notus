import { Sqlite } from "@notus/cloudflare/sqlite";
import type { Admission } from "@notus/contracts/source";
import * as Control from "@notus/control/task";
import * as ReadinessControl from "@notus/control/provisioning";
import * as Authentication from "@notus/control/runtime/auth";
import { Failure as RuntimeFailure } from "@notus/control/runtime/errors";
import * as Protocol from "@notus/control/runtime/protocol";
import * as Runtime from "@notus/control/runtime/server";
import { Attempts } from "@notus/executions/attempts";
import { Devbox } from "@notus/executions/devbox";
import { Provisioning } from "@notus/executions/provisioning";
import type { Observation } from "@notus/executions/types";
import { Slack } from "@notus/slack/service";
import { Sources } from "@notus/tasks/sources";
import { State } from "@notus/tasks/state";
import type { Environment } from "@notus/workspaces/types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { deploymentConfig, providerConfig, runtimeConfig } from "./config";
import * as RuntimeLayers from "./runtime";
import { cryptoLayer } from "./crypto";
import migrations from "./migrations/task/migrations";

export class Task extends Cloudflare.DurableObject<Task>()(
  "Task",
  Effect.gen(function* () {
    const host = yield* Cloudflare.DurableObjectState;
    const config = yield* deploymentConfig.pipe(Effect.orDie);
    const runtime = yield* runtimeConfig.pipe(Effect.orDie);
    const provider = runtime ? yield* providerConfig.pipe(Effect.orDie) : null;
    if (config.mode === "readiness" && !runtime)
      return yield* Effect.die("Readiness mode requires runtime authentication configuration");
    return { host, config, runtime, provider };
  }).pipe(
    // Alchemy runs this inner initialization with its RuntimeContext.
    Effect.map(({ host, config, runtime, provider }) =>
      Effect.gen(function* () {
        const db = yield* Drizzle.DurableObject({ migrations });
        const database = Sqlite.layer(db);
        const stateLayer = State.layer.pipe(Layer.provide([database, State.configuration(config)]));
        const attemptsLayer = Attempts.layer.pipe(Layer.provide(database));
        const provisioningLayer = Provisioning.layer.pipe(Layer.provide(database));
        const sourcesLayer = Sources.layer.pipe(
          Layer.provide([
            Layer.succeed(Sources.ConfigurationService, config),
            Layer.succeed(Slack.Configuration, {
              token: config.token,
              allowedChannel: config.channelId,
            }),
          ]),
        );
        const services = yield* Layer.build(
          Layer.merge(
            Layer.merge(stateLayer, sourcesLayer),
            Layer.merge(attemptsLayer, provisioningLayer),
          ).pipe(
            Layer.provideMerge(RuntimeLayers.execution(runtime, provider)),
            Layer.provide(cryptoLayer),
          ),
        ).pipe(Effect.orDie);
        const state = yield* State.Service.pipe(Effect.provideContext(services));
        const provisioning = yield* Provisioning.Service.pipe(Effect.provideContext(services));
        const devbox = yield* Devbox.Service.pipe(Effect.provideContext(services));
        const mode = state.snapshot.pipe(
          Effect.map((snapshot) => snapshot.task?.mode ?? config.mode),
        );
        const advance = Effect.fn("Task.advance")((now: number) =>
          Effect.gen(function* () {
            if ((yield* mode) === "readiness") return yield* ReadinessControl.advance(now);
            return yield* Control.advance(now, config.simulationDelayMs);
          }).pipe(Effect.provideContext(services)),
        );
        // Expected domain failures leave the gate as values, never rejected
        // promises that reset the object. Restore the error channel outside it.
        const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            const exit = yield* host.blockConcurrencyWhile(() => Effect.exit(effect));
            return yield* exit;
          });
        const arm = Effect.fn("Task.arm")(function* (at: number) {
          const existing = yield* host.storage.getAlarm();
          if (existing === null || existing > at) yield* host.storage.setAlarm(at);
        });
        const recompute = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const next =
            (yield* mode) === "readiness"
              ? yield* ReadinessControl.nextWake(now).pipe(Effect.provideContext(services))
              : yield* Control.nextWake(now).pipe(Effect.provideContext(services));
          if (next === null) yield* host.storage.deleteAlarm();
          else yield* host.storage.setAlarm(Math.max(now + 1, next));
        });
        const alarm = Effect.gen(function* () {
          yield* gate(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              // The alarm currently firing no longer counts as a recovery wake.
              yield* host.storage.setAlarm(now + config.claimTtlMs);
              yield* advance(now);
            }),
          );
          if ((yield* mode) === "readiness") {
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
          }
          const counts = { claimed: 0, confirmed: 0, rateLimited: 0, rejected: 0, ambiguous: 0 };
          for (let index = 0; index < 16; index++) {
            const claim = yield* gate(
              Effect.gen(function* () {
                // Arm before claiming, including after a slow previous send.
                yield* arm((yield* Clock.currentTimeMillis) + config.claimTtlMs);
                return yield* Control.claim().pipe(Effect.provideContext(services));
              }),
            );
            if (claim === null) break;
            counts.claimed++;
            yield* Effect.gen(function* () {
              // Network work must never enter the local gate.
              const outcome = yield* Control.deliver(claim).pipe(Effect.provideContext(services));
              yield* gate(
                Effect.gen(function* () {
                  yield* arm((yield* Clock.currentTimeMillis) + 1);
                  yield* state.recordDeliveryOutcome(
                    claim,
                    outcome,
                    yield* Clock.currentTimeMillis,
                  );
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
          // Even an empty scan must account for concurrent admission and all
          // outstanding sending claims before deleting the alarm.
          yield* gate(recompute);
          yield* Effect.logInfo("task.drain", counts);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("task.drain_failed").pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          // Alchemy serializes typed errors. A defect rejects the alarm for CF retry.
          Effect.orDie,
        );
        const runtimeResult = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) =>
              Effect.succeed({
                ok: false as const,
                reason: Schema.is(RuntimeFailure)(error) ? error.reason : ("unavailable" as const),
              }),
            ),
          );
        return {
          admit: (command: Admission) =>
            gate(
              Effect.gen(function* () {
                yield* arm((yield* Clock.currentTimeMillis) + 1);
                const selected = yield* mode;
                const receipt = yield* (
                  selected === "readiness"
                    ? ReadinessControl.admit(command)
                    : Control.admit(command, config.simulationDelayMs)
                ).pipe(Effect.provideContext(services));
                return {
                  receipt,
                  needsEnvironment:
                    selected === "readiness" && (yield* provisioning.current) === null,
                };
              }),
            ).pipe(
              Effect.map((result) => ({ ok: true as const, ...result })),
              Effect.orElseSucceed(() => ({
                ok: false as const,
                error: "admission_rejected" as const,
              })),
            ),
          prepareEnvironment: (environment: Environment | null) =>
            gate(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;
                yield* arm(now + 1);
                const task = (yield* state.snapshot).task;
                if (!task || task.mode !== "readiness" || task.closedAt !== null)
                  return yield* new RuntimeFailure({ reason: "unauthorized" });
                yield* provisioning.initialize(
                  {
                    taskId: task.id,
                    workspaceId: task.reservation.workspaceId,
                    environment,
                  },
                  now,
                );
                yield* advance(now);
                yield* recompute;
                return { ok: true as const };
              }),
            ).pipe(Effect.orElseSucceed(() => ({ ok: false as const }))),
          acceptOutcome: (observation: Observation) =>
            gate(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;
                yield* arm(now + 1);
                return yield* Control.acceptOutcome(observation, now).pipe(
                  Effect.provideContext(services),
                );
              }),
            ),
          runtimeAssignment: (capability: Authentication.Capability) =>
            runtimeResult(
              gate(
                Effect.gen(function* () {
                  if (capability._tag !== "Enrollment")
                    return yield* new RuntimeFailure({ reason: "unauthorized" });
                  return yield* Runtime.assignment(capability);
                }).pipe(Effect.provideContext(services)),
              ),
            ),
          runtimeEnroll: (
            capability: Authentication.Capability,
            request: Protocol.EnrollmentRequest,
          ) =>
            runtimeResult(
              Effect.gen(function* () {
                if (capability._tag !== "Enrollment")
                  return yield* new RuntimeFailure({ reason: "unauthorized" });
                const replay = yield* gate(
                  Runtime.replay(capability, request).pipe(Effect.provideContext(services)),
                );
                let grant = replay;
                if (!grant) {
                  const current = yield* gate(
                    Runtime.context(capability).pipe(Effect.provideContext(services)),
                  );
                  const verified = yield* Runtime.verify(capability, request, current).pipe(
                    Effect.provideContext(services),
                  );
                  grant = yield* gate(
                    Effect.gen(function* () {
                      const now = yield* Clock.currentTimeMillis;
                      yield* arm(now + 1);
                      const accepted = yield* Runtime.enroll(capability, verified, now).pipe(
                        Effect.provideContext(services),
                      );
                      yield* recompute;
                      return accepted;
                    }),
                  );
                }
                const reply = yield* Runtime.reply(
                  capability,
                  request,
                  grant,
                  yield* Clock.currentTimeMillis,
                ).pipe(Effect.provideContext(services));
                return yield* Schema.encodeEffect(Protocol.EnrollmentReply)(reply);
              }),
            ),
          runtimeReady: (
            capability: Authentication.Capability,
            request: Protocol.ReadinessRequest,
          ) =>
            runtimeResult(
              Effect.gen(function* () {
                if (capability._tag !== "Readiness")
                  return yield* new RuntimeFailure({ reason: "unauthorized" });
                const current = yield* gate(
                  Runtime.context(capability).pipe(Effect.provideContext(services)),
                );
                yield* Runtime.verifyReadiness(capability, current).pipe(
                  Effect.provideContext(services),
                );
                return yield* gate(
                  Effect.gen(function* () {
                    const now = yield* Clock.currentTimeMillis;
                    yield* arm(now + 1);
                    const reply = yield* Runtime.accept(capability, request, now).pipe(
                      Effect.provideContext(services),
                    );
                    yield* advance(now);
                    yield* recompute;
                    return reply;
                  }),
                );
              }),
            ),
          snapshot: () =>
            gate(
              Effect.gen(function* () {
                const snapshot = yield* Control.snapshot().pipe(Effect.provideContext(services));
                return (yield* mode) === "readiness"
                  ? { ...snapshot, provisioning: yield* provisioning.current }
                  : snapshot;
              }),
            ),
          alarm: () => alarm,
        };
      }),
    ),
  ),
) {}
