import { D1 } from "@notus/cloudflare/d1";
import { Sqlite } from "@notus/cloudflare/sqlite";
import { Sealed } from "@notus/cloudflare/sealed";
import { Inbox } from "@notus/control/inbox";
import { Platforms } from "@notus/platforms/registry";
import { Credentials } from "@notus/workspaces/credentials";
import { Compute } from "@notus/workspaces/compute";
import { Templates } from "@notus/workspaces/templates";
import { SharedDatabase } from "./database";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import type { Admission } from "@notus/platform/source";
import * as Control from "@notus/control/task";
import * as OperatorControl from "@notus/control/operator";
import * as ReadinessControl from "@notus/control/provisioning";
import * as Authentication from "@notus/control/runtime/auth";
import { Failure as RuntimeFailure } from "@notus/control/runtime/errors";
import * as Protocol from "@notus/control/runtime/protocol";
import * as Runtime from "@notus/control/runtime/server";
import { Attempts } from "@notus/executions/attempts";
import { Commands } from "@notus/executions/commands";
import { App as GithubApp } from "@notus/github/app";
import { Devbox } from "@notus/executions/devbox";
import { Provisioning } from "@notus/executions/provisioning";
import { Steps, type StepOutcome } from "@notus/executions/steps";
import type { CommandSpec, Observation, RepositoryRef } from "@notus/executions/types";
import { Operator } from "@notus/operator/operator";
import { State } from "@notus/tasks/state";
import type { Environment, ResolvedInstructions } from "@notus/workspaces/types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Redacted from "effect/Redacted";
import * as Broker from "./broker";
import {
  credentialKeyConfig,
  deploymentConfig,
  githubConfig,
  operatorConfig,
  runtimeConfig,
} from "./config";
import { Connection } from "./connection";
import * as RuntimeLayers from "./runtime";
import { cryptoLayer } from "./crypto";
import { platformsLayer } from "./platforms";
import migrations from "./migrations/task/migrations";

export class Task extends Cloudflare.DurableObject<Task>()(
  "Task",
  Effect.gen(function* () {
    const host = yield* Cloudflare.DurableObjectState;
    const config = yield* deploymentConfig.pipe(Effect.orDie);
    const runtime = yield* runtimeConfig.pipe(Effect.orDie);
    if (config.mode === "readiness" && !runtime)
      return yield* Effect.die("Readiness mode requires runtime authentication configuration");
    const operator = yield* operatorConfig.pipe(Effect.orDie);
    const github = yield* githubConfig.pipe(Effect.orDie);
    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    // Model requests leave this object only through the initiator's Connection object.
    const connections = yield* Connection;
    // Deliveries act for an installation, whose credential the shared database holds.
    const shared = yield* Cloudflare.D1.QueryDatabase(yield* SharedDatabase);
    const context = yield* CurrentRuntimeContext;
    if (!context) return yield* Effect.die("Task initialization requires Alchemy RuntimeContext");
    return {
      host,
      config,
      runtime,
      operator,
      github,
      connections,
      shared,
      credentialKey,
      context,
    };
  }).pipe(
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    // Alchemy runs this inner initialization with its RuntimeContext.
    Effect.map(
      ({ host, config, runtime, operator, github, connections, shared, credentialKey, context }) =>
        Effect.gen(function* () {
          const db = yield* Drizzle.DurableObject({ migrations });
          const database = Sqlite.layer(db);
          const stateLayer = State.layer.pipe(
            Layer.provide([database, State.configuration(config)]),
          );
          const attemptsLayer = Attempts.layer.pipe(Layer.provide(database));
          const provisioningLayer = Provisioning.layer.pipe(Layer.provide(database));
          const stepsLayer = Steps.layer.pipe(Layer.provide(database));
          const commandsLayer = Commands.layer.pipe(Layer.provide(database));
          // Deliveries reach their platform through the registry; this host never verifies webhooks or installs.
          const sourcesLayer = platformsLayer(config, github, {
            webhookSecret: null,
            slack: null,
            githubAppSlug: null,
            githubInstaller: null,
          }).pipe(
            Layer.provide(
              Credentials.layer.pipe(
                Layer.provide([Layer.effect(D1.Binding, shared.raw), Sealed.layer(credentialKey)]),
              ),
            ),
          );
          // Routes live in the shared database; the task moves one when it takes a conversation over.
          const inboxLayer = Inbox.layer.pipe(
            Layer.provide(sourcesLayer),
            Layer.provide(Layer.effect(D1.Binding, shared.raw)),
          );
          const services = yield* Layer.build(
            Layer.merge(
              Layer.merge(Layer.merge(stateLayer, sourcesLayer), inboxLayer),
              Layer.merge(
                Layer.merge(attemptsLayer, provisioningLayer),
                Layer.merge(stepsLayer, commandsLayer),
              ),
            ).pipe(
              Layer.provideMerge(RuntimeLayers.execution(runtime)),
              // A workspace's provider account and templates live in the shared database.
              Layer.provide(
                Layer.merge(Templates.layer, Compute.credentials).pipe(
                  Layer.provide([
                    Layer.effect(D1.Binding, shared.raw),
                    Sealed.layer(credentialKey),
                  ]),
                ),
              ),
              Layer.provide(cryptoLayer),
            ),
          ).pipe(Effect.orDie);
          const state = yield* State.Service.pipe(Effect.provideContext(services));
          const provisioning = yield* Provisioning.Service.pipe(Effect.provideContext(services));
          const devbox = yield* Devbox.Service.pipe(Effect.provideContext(services));
          const steps = yield* Steps.Service.pipe(Effect.provideContext(services));
          const commands = yield* Commands.Service.pipe(Effect.provideContext(services));
          // Built lazily per claim; absent configuration fails the checkout, never the object.
          const githubLayer = github
            ? GithubApp.layer.pipe(
                Layer.provide([
                  Layer.succeed(GithubApp.Configuration, github),
                  FetchHttpClient.layer,
                ]),
              )
            : null;
          const mint = (repository: RepositoryRef, kind: "checkout" | "push") =>
            githubLayer
              ? GithubApp.Service.pipe(
                  Effect.flatMap((app) => app.forInstallation(repository.installationId)),
                  Effect.flatMap((app) =>
                    kind === "checkout" ? app.readToken(repository) : app.pushToken(repository),
                  ),
                  Effect.provide(githubLayer),
                  // Non-secret: what GitHub granted for this one operation.
                  Effect.tap((token) =>
                    Effect.logInfo(
                      `task.github_token ${kind} permissions=${Object.entries(
                        token.granted.permissions,
                      )
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
              State.Service.pipe(
                Effect.flatMap((state) => state.snapshot),
                Effect.map((snapshot) => snapshot.task?.reservation.initiatorId ?? null),
                Effect.provideContext(services),
              ),
            ).pipe(Effect.orElseSucceed(() => null)),
          );
          /** The initiator's GitHub sign-in for git on the box; null when they have none or it cannot be refreshed. */
          const githubAuth = (minimumLifetimeMs: number) =>
            Effect.gen(function* () {
              const initiatorId = yield* initiator;
              if (initiatorId === null) return null;
              const login = yield* connections
                .getByName(initiatorId)
                .githubLogin(initiatorId, minimumLifetimeMs);
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
              const login = yield* connections
                .getByName(initiatorId)
                .agentLogin(initiatorId, lifetimeMs);
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
            githubLayer
              ? GithubApp.Service.pipe(
                  Effect.flatMap((app) =>
                    app.forInstallation(command.spec.repository.installationId),
                  ),
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
                  Effect.provide(githubLayer),
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
            Platforms.Service.pipe(
              Effect.flatMap((platforms) => platforms.forInstallation(command.spec.target.source)),
              Effect.flatMap((port) => port.conversations.resolveReply(command.spec.target)),
              Effect.flatMap((handle) => handle.reply(command.spec.text, command.id)),
              Effect.provideContext(services),
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
          // Built once per object lifetime; each model request selects its operation at call time.
          const model = yield* Layer.build(
            Broker.languageModel(connections, context, operator),
          ).pipe(Effect.orDie);
          const mode = state.snapshot.pipe(
            Effect.map((snapshot) => snapshot.task?.mode ?? config.mode),
          );
          const advance = Effect.fn("Task.advance")((now: number) =>
            Effect.gen(function* () {
              const selected = yield* mode;
              if (selected === "readiness") return yield* ReadinessControl.advance(now);
              if (selected === "operator") return yield* OperatorControl.advance(now);
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
            const selected = yield* mode;
            const next =
              selected === "readiness"
                ? yield* ReadinessControl.nextWake(now).pipe(Effect.provideContext(services))
                : selected === "operator"
                  ? yield* OperatorControl.nextWake(now).pipe(Effect.provideContext(services))
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
                    return yield* OperatorControl.claim(now).pipe(Effect.provideContext(services));
                  }),
                );
                if (!claimed) break;
                // The model round runs outside the gate; the Connection object owns credentials.
                const outcome = yield* Operator.run(claimed.briefing, claimed.step.priorParts).pipe(
                  Effect.provideService(Broker.Operation, {
                    userId: claimed.briefing.initiatorId,
                    operationId: claimed.step.operationId,
                  }),
                  Effect.provideContext(model),
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
                    yield* OperatorControl.record(claimed.step, outcome, now).pipe(
                      Effect.provideContext(services),
                    );
                    yield* recompute;
                  }),
                ).pipe(Effect.catchCause(() => Effect.logError("task.operator_record_failed")));
              }
            }
            if ((yield* mode) === "operator") {
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
                  reason: Schema.is(RuntimeFailure)(error)
                    ? error.reason
                    : ("unavailable" as const),
                }),
              ),
            );
          return {
            admit: (command: Admission) =>
              gate(
                Effect.gen(function* () {
                  const selected = yield* mode;
                  const receipt = yield* (
                    selected === "readiness"
                      ? ReadinessControl.admit(command)
                      : selected === "operator"
                        ? OperatorControl.admit(command)
                        : Control.admit(command, config.simulationDelayMs)
                  ).pipe(Effect.provideContext(services));
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
                    yield* OperatorControl.prepare(
                      environment,
                      repositories,
                      instructions,
                      now,
                    ).pipe(Effect.provideContext(services));
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
                        return yield* Runtime.poll(capability, now).pipe(
                          Effect.provideContext(services),
                        );
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
                      yield* Runtime.authorize(capability, now).pipe(
                        Effect.provideContext(services),
                      );
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
            runtimeObserve: (
              capability: Authentication.Capability,
              request: Protocol.ObserveRequest,
            ) =>
              runtimeResult(
                Effect.gen(function* () {
                  if (capability._tag !== "Readiness")
                    return yield* new RuntimeFailure({ reason: "unauthorized" });
                  return yield* gate(
                    Effect.gen(function* () {
                      const now = yield* Clock.currentTimeMillis;
                      yield* arm(now + 1);
                      const reply = yield* Runtime.observe(capability, request, now).pipe(
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
            alarm: () => alarm,
          };
        }),
    ),
  ),
) {}
