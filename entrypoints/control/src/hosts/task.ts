import type { Provider } from "@notus/compute/provider";
import { Activity } from "@notus/executions/activity";
import { Attempts } from "@notus/executions/attempts";
import { Commands } from "@notus/executions/commands";
import { Devbox } from "@notus/executions/devbox";
import { Provisioning } from "@notus/executions/provisioning";
import { Steps, type StepOutcome } from "@notus/executions/steps";
import type { CommandSpec, Observation, RepositoryRef } from "@notus/executions/types";
import { App as GithubApp } from "@notus/github/app";
import { Operator } from "@notus/operator/operator";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import type { Admission } from "@notus/platform/source";
import { Platforms } from "@notus/platforms/registry";
import { State } from "@notus/tasks/state";
import { Compute } from "@notus/workspaces/compute";
import { Credentials } from "@notus/workspaces/credentials";
import { Templates } from "@notus/workspaces/templates";
import type { Environment, ResolvedInstructions } from "@notus/workspaces/types";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as LanguageModel from "effect/ai/LanguageModel";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Broker from "../broker";
import type { DeploymentConfig, GithubConfig, OperatorConfig, RuntimeConfig } from "../config";
import { cryptoLayer } from "../crypto";
import { execution } from "../devbox";
import { Inbox } from "../inbox";
import { OperatorControl } from "../operator";
import { platformsLayer } from "../platforms";
import { ReadinessControl } from "../provisioning";
import * as Authentication from "../runtime/auth";
import { Failure as RuntimeFailure } from "../runtime/errors";
import * as Protocol from "../runtime/protocol";
import { Server } from "../runtime/server";
import { Control } from "../task";
import { View } from "../view";
import { ConnectionHost } from "./connection";
import { Durable } from "./durable";

/** What the Task object reads from deployment configuration, once, during construction. */
export interface Settings {
  readonly deployment: DeploymentConfig;
  readonly runtime: RuntimeConfig | null;
  readonly operator: OperatorConfig;
  readonly github: GithubConfig | null;
  readonly providers: ReadonlyArray<Provider>;
}

/**
 * One task's authoritative record and its operator loop. The object's alarm drives provisioning,
 * model rounds, control actions and deliveries; each step runs under the object's gate and every
 * provider call outside it.
 */
const make = (settings: Settings["deployment"]) =>
  Effect.gen(function* () {
    const durable = yield* Durable.Service;
    // Model requests leave this object only through the initiator's Connection object.
    const remote = yield* ConnectionHost.Remote;
    const state = yield* State.Service;
    const provisioning = yield* Provisioning.Service;
    const devbox = yield* Devbox.Service;
    // Built once per object: what it holds lives as long as the object does.
    const activity = yield* Activity.Service;
    const steps = yield* Steps.Service;
    const commands = yield* Commands.Service;
    const platforms = yield* Platforms.Service;
    // Each model request selects its operation at call time.
    const model = yield* LanguageModel.LanguageModel;
    const control = yield* Control.Service;
    const operatorControl = yield* OperatorControl.Service;
    const readiness = yield* ReadinessControl.Service;
    const server = yield* Server.Service;
    const views = yield* View.Service;

    // Absent configuration fails the checkout, never the object.
    const github = yield* Effect.serviceOption(GithubApp.Service);

    const mint = (repository: RepositoryRef, kind: "checkout" | "push") =>
      Option.isSome(github)
        ? github.value.forInstallation(repository.installationId).pipe(
            Effect.flatMap((app) =>
              kind === "checkout" ? app.readToken(repository) : app.pushToken(repository),
            ),
            // Non-secret: what GitHub granted for this one operation.
            Effect.tap((token) =>
              Effect.logInfo(
                `task.github_token ${kind} permissions=${Object.entries(token.granted.permissions)
                  .map(([key, value]) => `${key}:${value}`)
                  .join(
                    ",",
                  )} repositories=${token.granted.repositories.join(",")} length=${Redacted.value(token.token).length}`,
              ),
            ),
            Effect.tapError((error) =>
              Effect.logWarning(
                `task.github_token_failed ${kind} ${error.operation} ${error.reason}${error.status === undefined ? "" : ` http=${error.status}`}`,
              ),
            ),
            Effect.map((token) => Redacted.value(token.token)),
            Effect.option,
          )
        : Effect.succeedNone;

    /**
     * A Codex login file for one specialist round, from the initiator's agent connection. The
     * refresh token stays in the Connection object; the file is returned once, never persisted.
     */
    /** The Codex CLI login file shape: tokens only, no API key, no refresh token. */
    const CodexAuthFile = Schema.fromJsonString(
      Schema.Struct({
        OPENAI_API_KEY: Schema.Null,
        tokens: Schema.Struct({
          id_token: Schema.NonEmptyString,
          access_token: Schema.NonEmptyString,
          refresh_token: Schema.Literal(""),
          account_id: Schema.NonEmptyString,
        }),
        last_refresh: Schema.NonEmptyString,
      }),
    );

    const initiator = Effect.suspend(() =>
      gate(
        state.snapshot.pipe(
          Effect.map((snapshot) => snapshot.task?.reservation.initiatorId ?? null),
        ),
      ).pipe(Effect.orElseSucceed(() => null)),
    );

    /** The initiator's GitHub sign-in for git on the box; null when they have none or it cannot be refreshed. */
    const githubAuth = (minimumLifetimeMs: number) =>
      Effect.gen(function* () {
        const initiatorId = yield* initiator;
        if (initiatorId === null) return null;

        const login = yield* remote(initiatorId).githubLogin(initiatorId, minimumLifetimeMs);

        if (!login.ok) {
          yield* Effect.logWarning(`task.github_login_failed ${login.reason}`);
          return null;
        }

        return login.value;
      }).pipe(Effect.catchCause(() => Effect.succeed(null)));

    const agentAuth = (lifetimeMs: number) =>
      Effect.gen(function* () {
        const initiatorId = yield* initiator;
        if (initiatorId === null) return Option.none<string>();

        const login = yield* remote(initiatorId).agentLogin(initiatorId, lifetimeMs);

        if (!login.ok) {
          yield* Effect.logWarning(`task.agent_login_failed ${login.reason}`);
          return Option.none<string>();
        }

        const now = yield* Clock.currentTimeMillis;

        yield* Effect.logInfo(
          `task.agent_login expires_in_min=${Math.floor((login.value.expiresAt - now) / 60_000)}`,
        );

        const file = yield* Schema.encodeEffect(CodexAuthFile)({
          OPENAI_API_KEY: null,
          tokens: {
            id_token: login.value.idToken,
            access_token: login.value.access,
            refresh_token: "",
            account_id: login.value.accountId,
          },
          last_refresh: DateTime.formatIso(DateTime.makeUnsafe(now)),
        });

        return Option.some(file);
      }).pipe(Effect.catchCause(() => Effect.succeed(Option.none<string>())));

    /** Opening a pull request: a control-plane action with the App's token, never on the box. */
    const openPullRequest = (command: {
      readonly id: string;
      readonly spec: Extract<CommandSpec, { readonly kind: "pull-request" }>;
    }) =>
      Option.isSome(github)
        ? github.value.forInstallation(command.spec.repository.installationId).pipe(
            Effect.flatMap((app) =>
              app.createPullRequest(
                {
                  owner: command.spec.repository.owner,
                  name: command.spec.repository.name,
                  defaultBranch: command.spec.base,
                },
                {
                  branch: command.spec.branch,
                  title: command.spec.title,
                  body: command.spec.body,
                },
              ),
            ),
            Effect.map((pull) => ({
              exitCode: 0,
              stdout: "",
              stderr: "",
              durationMs: 0,
              timedOut: false,
              truncated: false,
              pullRequest: {
                number: pull.number,
                url: pull.url,
                branch: pull.branch,
                // The conversation this task opened, so feedback there can attach to it.
                source: {
                  platform: "github" as const,
                  installationId: InstallationId.make(command.spec.repository.installationId),
                  scope: PlatformId.make(
                    `${command.spec.repository.owner}/${command.spec.repository.name}`,
                  ),
                  conversation: PlatformId.make(String(pull.number)),
                },
              },
            })),
            Effect.catch((error) =>
              Effect.succeed({
                exitCode: 1,
                stdout: "",
                stderr: `${error.operation} ${error.reason}${error.status === undefined ? "" : ` http=${error.status}`}${error.detail === undefined ? "" : ` (${error.detail})`}`,
                durationMs: 0,
                timedOut: false,
                truncated: false,
              }),
            ),
          )
        : Effect.succeed({
            exitCode: 1,
            stdout: "",
            stderr: "github-credential-unavailable",
            durationMs: 0,
            timedOut: false,
            truncated: false,
          });

    /** A message in the origin conversation, sent through its platform; the command id keeps it idempotent. */
    const postUpdate = (command: {
      readonly id: string;
      readonly spec: Extract<CommandSpec, { readonly kind: "update" }>;
    }) =>
      platforms.forInstallation(command.spec.target.source).pipe(
        Effect.flatMap((port) => port.conversations.resolveReply(command.spec.target)),
        Effect.flatMap((handle) => handle.reply(command.spec.text, command.id)),
        Effect.map((receipt) => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 0,
          timedOut: false,
          truncated: false,
          update: { reference: receipt.reference },
        })),
        Effect.catch((error) =>
          Effect.succeed({
            exitCode: 1,
            stdout: "",
            stderr:
              error._tag === "Sources.SourceError"
                ? `update ${error.classification}`
                : "update unavailable",
            durationMs: 0,
            timedOut: false,
            truncated: false,
          }),
        ),
      );

    const performControl = (command: {
      readonly id: string;
      readonly spec: Extract<CommandSpec, { readonly kind: "pull-request" | "update" }>;
    }) =>
      command.spec.kind === "update"
        ? postUpdate({ id: command.id, spec: command.spec })
        : openPullRequest({ id: command.id, spec: command.spec });

    const mode = state.snapshot.pipe(
      Effect.map((snapshot) => snapshot.task?.mode ?? settings.mode),
    );

    const advance = Effect.fn("Task.advance")((now: number) =>
      Effect.gen(function* () {
        const selected = yield* mode;

        if (selected === "readiness") return yield* readiness.advance(now);
        if (selected === "operator") return yield* operatorControl.advance(now);
        return yield* control.advance(now, settings.simulationDelayMs);
      }),
    );

    const gate = durable.gate;

    const arm = Effect.fn("Task.arm")(function* (at: number) {
      const existing = yield* durable.alarm;
      if (existing === null || existing > at) yield* durable.setAlarm(at);
    });

    const recompute = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const selected = yield* mode;
      const next =
        selected === "readiness"
          ? yield* readiness.nextWake(now)
          : selected === "operator"
            ? yield* operatorControl.nextWake(now)
            : yield* control.nextWake(now);

      // A working box's hold is renewed by this alarm too.
      const held = selected === "operator" ? yield* activity.nextWake(now) : null;
      const at = next === null ? held : held === null ? next : Math.min(next, held);

      if (at === null) yield* durable.deleteAlarm;
      else yield* durable.setAlarm(Math.max(now + 1, at));
    });

    const alarm = Effect.gen(function* () {
      yield* gate(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          // The alarm currently firing no longer counts as a recovery wake.
          yield* durable.setAlarm(now + settings.claimTtlMs);
          yield* advance(now);
        }),
      );

      // Readiness tasks always provision; operator tasks provision once the operator asked.
      if ((yield* mode) !== "simulation") {
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
      }

      if ((yield* mode) === "operator") {
        for (let index = 0; index < 4; index++) {
          const claimed = yield* gate(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              // Cover the step lease so a lost isolate re-offers the step.
              yield* arm(now + 150_000);
              return yield* operatorControl.claim(now);
            }),
          );
          if (!claimed) break;

          // The model round runs outside the gate; the Connection object owns credentials.
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

              yield* operatorControl.record(claimed.step, outcome, now);

              yield* recompute;
            }),
          ).pipe(Effect.catchCause(() => Effect.logError("task.operator_record_failed")));
        }
      }

      if ((yield* mode) === "operator") {
        yield* Effect.gen(function* () {
          const due = yield* gate(
            Effect.gen(function* () {
              return yield* activity.due(yield* Clock.currentTimeMillis);
            }),
          );

          // Provider call outside the gate; a lost hold runs out by itself.
          if (due !== null) yield* activity.perform(due, yield* Clock.currentTimeMillis);
        }).pipe(Effect.catchCause(() => Effect.logError("task.activity_failed")));

        yield* Effect.gen(function* () {
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
              yield* provisioning.retired(
                retiring.attemptId,
                ended,
                yield* Clock.currentTimeMillis,
              );
            }),
          );
        }).pipe(Effect.catchCause(() => Effect.logError("task.retire_failed")));

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
          const result = yield* performControl({ id: claimed.command.id, spec });

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
      }

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
          // Network work must never enter the local gate.
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
            const selected = yield* mode;

            const receipt = yield* selected === "readiness"
              ? readiness.admit(command)
              : selected === "operator"
                ? operatorControl.admit(command)
                : control.admit(command, settings.simulationDelayMs);

            const needsEnvironment =
              selected === "readiness"
                ? (yield* provisioning.current) === null
                : selected === "operator"
                  ? (yield* provisioning.captured) === null
                  : false;

            // A task still waiting for its environment and repositories must not take its
            // first step before prepareEnvironment stored them; that call arms the alarm.
            if (!needsEnvironment) yield* arm((yield* Clock.currentTimeMillis) + 1);

            return { receipt, needsEnvironment };
          }),
        ).pipe(
          Effect.map((result) => ({ ok: true as const, ...result })),
          Effect.orElseSucceed(() => ({
            ok: false as const,
            error: "admission_rejected" as const,
          })),
        ),
      prepareEnvironment: (
        environment: Environment | null,
        repositories: ReadonlyArray<RepositoryRef>,
        instructions: ResolvedInstructions,
      ) =>
        gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;

            yield* arm(now + 1);
            const task = (yield* state.snapshot).task;

            if (!task || task.closedAt !== null)
              return yield* new RuntimeFailure({ reason: "unauthorized" });

            if (task.mode === "operator") {
              yield* operatorControl.prepare(environment, repositories, instructions, now);
            } else if (task.mode === "readiness") {
              yield* provisioning.initialize(
                {
                  taskId: task.id,
                  workspaceId: task.reservation.workspaceId,
                  environment,
                },
                now,
              );
            } else return yield* new RuntimeFailure({ reason: "unauthorized" });

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

            return yield* control.acceptOutcome(observation, now);
          }),
        ),
      runtimeAssignment: (capability: Authentication.Capability) =>
        runtimeResult(
          gate(
            Effect.gen(function* () {
              if (capability._tag !== "Enrollment")
                return yield* new RuntimeFailure({ reason: "unauthorized" });

              return yield* server.assignment(capability);
            }),
          ),
        ),
      runtimeEnroll: (capability: Authentication.Capability, request: Protocol.EnrollmentRequest) =>
        runtimeResult(
          Effect.gen(function* () {
            if (capability._tag !== "Enrollment")
              return yield* new RuntimeFailure({ reason: "unauthorized" });

            const replay = yield* gate(server.replay(capability, request));
            let grant = replay;

            if (!grant) {
              const current = yield* gate(server.context(capability));

              const verified = yield* server.verify(capability, request, current);

              grant = yield* gate(
                Effect.gen(function* () {
                  const now = yield* Clock.currentTimeMillis;

                  yield* arm(now + 1);

                  const accepted = yield* server.enroll(capability, verified, now);

                  yield* recompute;

                  return accepted;
                }),
              );
            }

            const reply = yield* server.reply(
              capability,
              request,
              grant,
              yield* Clock.currentTimeMillis,
            );

            return yield* Schema.encodeEffect(Protocol.EnrollmentReply)(reply);
          }),
        ),
      runtimeReady: (capability: Authentication.Capability, request: Protocol.ReadinessRequest) =>
        runtimeResult(
          Effect.gen(function* () {
            if (capability._tag !== "Readiness")
              return yield* new RuntimeFailure({ reason: "unauthorized" });

            const current = yield* gate(server.context(capability));

            yield* server.verifyReadiness(capability, current);

            return yield* gate(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;

                yield* arm(now + 1);

                const reply = yield* server.accept(capability, request, now);

                yield* advance(now);
                yield* recompute;

                return reply;
              }),
            );
          }),
        ),
      runtimePoll: (capability: Authentication.Capability, request: Protocol.PollRequest) =>
        runtimeResult(
          Effect.gen(function* () {
            if (capability._tag !== "Readiness")
              return yield* new RuntimeFailure({ reason: "unauthorized" });

            // Wait outside the gate; each attempt is one short claim inside it.
            const deadline = (yield* Clock.currentTimeMillis) + request.waitMs;

            while (true) {
              const reply = yield* gate(
                Effect.gen(function* () {
                  const now = yield* Clock.currentTimeMillis;

                  const reply = yield* server.poll(capability, now);

                  // A command now runs on the box; the alarm holds it awake at once.
                  if (reply.command !== null) yield* arm(now + 1);

                  return reply;
                }),
              );

              if (reply.command !== null) {
                const command = reply.command;
                let credential: string | null = null;

                if (
                  command.spec.kind === "checkout" ||
                  command.spec.kind === "push" ||
                  command.spec.kind === "specialist"
                ) {
                  // Minted outside the gate, returned once, never persisted.
                  const token =
                    command.spec.kind === "specialist"
                      ? // Refresh first if the login would expire before the round's deadline.
                        yield* agentAuth(command.spec.timeoutMs + 10 * 60_000)
                      : yield* mint(command.spec.repository, command.spec.kind);

                  if (token._tag === "None") {
                    yield* gate(
                      Effect.gen(function* () {
                        const now = yield* Clock.currentTimeMillis;

                        yield* commands.fail(
                          command.id,
                          command.spec.kind === "specialist"
                            ? "agent-credential-unavailable"
                            : "github-credential-unavailable",
                          now,
                        );

                        yield* advance(now);
                        yield* recompute;
                      }),
                    );

                    return yield* Schema.encodeEffect(Protocol.PollReply)({ command: null });
                  }

                  credential = token.value;
                }

                return yield* Schema.encodeEffect(Protocol.PollReply)({
                  command: { id: command.id, spec: command.spec, credential },
                });
              }

              if ((yield* Clock.currentTimeMillis) >= deadline)
                return yield* Schema.encodeEffect(Protocol.PollReply)({ command: null });

              yield* Effect.sleep("1 second");
            }
          }),
        ),
      runtimeLogin: (capability: Authentication.Capability) =>
        runtimeResult(
          Effect.gen(function* () {
            if (capability._tag !== "Readiness")
              return yield* new RuntimeFailure({ reason: "unauthorized" });

            yield* gate(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;

                yield* server.authorize(capability, now);
              }),
            );

            // Fetched outside the gate, returned once, never persisted by this object.
            const login = yield* githubAuth(60 * 60_000);

            return yield* Schema.encodeEffect(Protocol.LoginReply)({
              github:
                login === null
                  ? null
                  : {
                      token: login.access,
                      expiresAt: login.expiresAt,
                      login: login.login,
                      name: login.name,
                      email: login.email,
                    },
            });
          }),
        ),
      runtimeObserve: (capability: Authentication.Capability, request: Protocol.ObserveRequest) =>
        runtimeResult(
          Effect.gen(function* () {
            if (capability._tag !== "Readiness")
              return yield* new RuntimeFailure({ reason: "unauthorized" });

            return yield* gate(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;

                yield* arm(now + 1);

                const reply = yield* server.observe(capability, request, now);

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
            const snapshot = yield* control.snapshot();
            const selected = yield* mode;

            return selected === "readiness"
              ? { ...snapshot, provisioning: yield* provisioning.current }
              : selected === "operator"
                ? {
                    ...snapshot,
                    steps: yield* steps.snapshot,
                    commands: yield* commands.snapshot,
                    provisioning: yield* provisioning.current,
                  }
                : snapshot;
          }),
        ),
      /** What the dashboard shows of this task; null when the object holds none. */
      view: () =>
        gate(views.read()).pipe(
          Effect.tapError(() => Effect.logWarning("task.view_failed")),
          Effect.orElseSucceed(() => null),
        ),
      summary: () =>
        gate(
          views
            .read()
            .pipe(Effect.map((detail) => (detail === null ? null : View.summarize(detail)))),
        ).pipe(
          Effect.tapError(() => Effect.logWarning("task.summary_failed")),
          Effect.orElseSucceed(() => null),
        ),
      alarm: () => alarm,
    };
  });

// A type, not an interface: object RPC shapes need its implicit index signature.
export type Interface = Effect.Success<ReturnType<typeof make>>;

/**
 * Methods run inside an object or Worker handler, which supplies the runtime context.
 *
 * @effect-expect-leaking RuntimeContext
 */
// oxlint-disable-next-line effecttsgo/lazy-effect -- object RPC members are calls on the stub.
export class Service extends Context.Service<Service, Interface>()("@notus/control/hosts/Task") {}

/** A task's object by task ID; the app resolves it to the object's stub. */
export class Remote extends Context.Service<Remote, (taskId: string) => Interface>()(
  "@notus/control/hosts/Task/Remote",
) {}

export const layerNoDeps = (settings: Settings["deployment"]) =>
  Layer.effect(Service, make(settings));

/**
 * The task host over this deployment's domains. Leaves the object's own database, the shared
 * database, the sealing key, the recipe, the object host and the initiator's Connection to the app.
 */
export const layer = (settings: Settings) => {
  // Deliveries reach their platform through the registry; this host never verifies webhooks or installs.
  const platforms = platformsLayer(settings.deployment, settings.github, {
    webhookSecret: null,
    slack: null,
    githubAppSlug: null,
    githubInstaller: null,
  });

  const github = settings.github
    ? [
        GithubApp.layer.pipe(
          Layer.provide([
            Layer.succeed(GithubApp.Configuration, settings.github),
            FetchHttpClient.layer,
          ]),
        ),
      ]
    : [];

  const domains = Layer.mergeAll(
    State.layer.pipe(Layer.provide(State.configuration(settings.deployment))),
    Attempts.layer,
    Provisioning.layer,
    Steps.layer,
    Commands.layer,
    platforms,
    // Routes live in the shared database; the task moves one when it takes a conversation over.
    Inbox.layer.pipe(Layer.provide(platforms)),
  );

  // The task's use cases; the operator's settles outcomes through the plain task's.
  const useCases = Layer.mergeAll(
    OperatorControl.layer,
    ReadinessControl.layer,
    Server.layer,
    View.layer,
  ).pipe(Layer.provideMerge(Control.layer));

  return layerNoDeps(settings.deployment).pipe(
    Layer.provide([Activity.layer, Broker.languageModel(settings.operator), ...github]),
    Layer.provideMerge(useCases),
    Layer.provideMerge(domains),
    Layer.provideMerge(execution(settings.runtime, settings.providers)),
    // A workspace's provider account, templates and installations live in the shared database.
    Layer.provide(Layer.mergeAll(Templates.layer, Compute.credentials, Credentials.layer)),
    Layer.provide(cryptoLayer),
  );
};

export * as TaskHost from "./task";
