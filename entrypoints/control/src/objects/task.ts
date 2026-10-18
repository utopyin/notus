import { Sealed } from "@notus/cloudflare/sealed";
import { SharedDb } from "@notus/db/shared";
import { Activity } from "@notus/executions/activity";
import { Attempts } from "@notus/executions/attempts";
import { Commands } from "@notus/executions/commands";
import { Provisioning } from "@notus/executions/provisioning";
import { Steps } from "@notus/executions/steps";
import type { Observation, RepositoryRef } from "@notus/executions/types";
import { App as GithubApp } from "@notus/github/app";
import type { Admission } from "@notus/platform/source";
import { State } from "@notus/tasks/state";
import { Compute } from "@notus/workspaces/compute";
import { Credentials } from "@notus/workspaces/credentials";
import { Templates } from "@notus/workspaces/templates";
import type { Environment, ResolvedInstructions } from "@notus/workspaces/types";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Actions } from "../actions";
import { Alarm } from "../alarm";
import * as Broker from "../broker";
import {
  type DeploymentConfig,
  computeConfig,
  credentialKeyConfig,
  deploymentConfig,
  githubConfig,
  operatorConfig,
  runtimeConfig,
} from "../config";
import { cryptoLayer } from "../crypto";
import { execution } from "../devbox";
import { Inbox } from "../inbox";
import { OperatorControl } from "../operator";
import { platformsLayer } from "../platforms";
import { ReadinessControl } from "../provisioning";
import type * as Auth from "../runtime/auth";
import { Endpoint } from "../runtime/endpoint";
import { Failure } from "../runtime/errors";
import type * as Protocol from "../runtime/protocol";
import { Server } from "../runtime/server";
import { Control } from "../task";
import { Tokens } from "../tokens";
import { View } from "../view";
import { ConnectionObject } from "./connection";
import { Durable } from "./durable";

/** One task's authoritative record and its operator loop, addressed by task ID. */
const methods = (settings: DeploymentConfig) =>
  Effect.gen(function* () {
    const durable = yield* Durable.Service;
    const state = yield* State.Service;
    const provisioning = yield* Provisioning.Service;
    const steps = yield* Steps.Service;
    const commands = yield* Commands.Service;
    const control = yield* Control.Service;
    const operator = yield* OperatorControl.Service;
    const readiness = yield* ReadinessControl.Service;
    const views = yield* View.Service;
    const alarm = yield* Alarm.Service;
    const endpoint = yield* Endpoint.Service;

    const gate = durable.gate;

    return {
      admit: (command: Admission) =>
        gate(
          Effect.gen(function* () {
            const selected = yield* alarm.mode;

            const receipt = yield* selected === "readiness"
              ? readiness.admit(command)
              : selected === "operator"
                ? operator.admit(command)
                : control.admit(command, settings.simulationDelayMs);

            const needsEnvironment =
              selected === "readiness"
                ? (yield* provisioning.current) === null
                : selected === "operator"
                  ? (yield* provisioning.captured) === null
                  : false;

            // A task still waiting for its environment and repositories must not take its
            // first step before prepareEnvironment stored them; that call arms the alarm.
            if (!needsEnvironment) yield* alarm.arm((yield* Clock.currentTimeMillis) + 1);

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

            yield* alarm.arm(now + 1);
            const task = (yield* state.snapshot).task;

            if (!task || task.closedAt !== null)
              return yield* new Failure({ reason: "unauthorized" });

            if (task.mode === "operator") {
              yield* operator.prepare(environment, repositories, instructions, now);
            } else if (task.mode === "readiness") {
              yield* provisioning.initialize(
                { taskId: task.id, workspaceId: task.reservation.workspaceId, environment },
                now,
              );
            } else return yield* new Failure({ reason: "unauthorized" });

            yield* alarm.advance(now);
            yield* alarm.recompute;

            return { ok: true as const };
          }),
        ).pipe(Effect.orElseSucceed(() => ({ ok: false as const }))),
      acceptOutcome: (observation: Observation) =>
        gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* alarm.arm(now + 1);

            return yield* control.acceptOutcome(observation, now);
          }),
        ),
      /** One dev box call whose capability the Worker verified. */
      runtime: (capability: Auth.Capability, request: Protocol.Request) =>
        endpoint.call(capability, request),
      snapshot: () =>
        gate(
          Effect.gen(function* () {
            const snapshot = yield* control.snapshot();
            const selected = yield* alarm.mode;

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
      alarm: () => alarm.run,
    };
  });

// A type, not an interface: object RPC shapes need its implicit index signature.
export type Interface = Effect.Success<ReturnType<typeof methods>>;

// oxlint-disable-next-line effecttsgo/lazy-effect -- object RPC members are calls on the stub.
export class Service extends Context.Service<Service, Interface>()("@notus/control/objects/Task") {}

/** A task's object by task ID; the app resolves it to the object's stub. */
export class Remote extends Context.Service<Remote, (taskId: string) => Interface>()(
  "@notus/control/objects/Task/Remote",
) {}

export const layerNoDeps = (settings: DeploymentConfig) => Layer.effect(Service, methods(settings));

/**
 * Construction: reads the deployment's settings and takes what outlives one object: the shared
 * database (routes, installations, templates and provider accounts) and the initiators'
 * Connection objects, through which every model request leaves. The result builds one object; it
 * leaves the object's own database, its durable state and the recipe to the app.
 */
export const make = Effect.gen(function* () {
  const deployment = yield* deploymentConfig;
  const runtime = yield* runtimeConfig;

  if (deployment.mode === "readiness" && !runtime)
    return yield* Effect.die("Readiness mode requires runtime authentication configuration");

  const operator = yield* operatorConfig;
  const github = yield* githubConfig;
  const providers = yield* computeConfig;
  const key = yield* credentialKeyConfig;
  const shared = yield* SharedDb.Service;
  const connections = yield* ConnectionObject.Remote;

  // Deliveries reach their platform through the registry; this object never verifies webhooks or installs.
  const platforms = platformsLayer(deployment, github, {
    webhookSecret: null,
    slack: null,
    githubAppSlug: null,
    githubInstaller: null,
  });

  // Absent configuration fails a checkout or a pull request, never the object.
  const app = github
    ? GithubApp.layer.pipe(
        Layer.provide([Layer.succeed(GithubApp.Configuration, github), FetchHttpClient.layer]),
      )
    : Layer.empty;

  const domains = Layer.mergeAll(
    State.layer.pipe(Layer.provide(State.configuration(deployment))),
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

  const loop = Alarm.layer(deployment).pipe(
    Layer.provide([Activity.layer, Broker.languageModel(operator), Actions.layer]),
  );

  const object = layerNoDeps(deployment).pipe(
    Layer.provide(Endpoint.layer),
    Layer.provide([loop, Tokens.layer]),
    Layer.provide(app),
    Layer.provide(useCases),
    Layer.provide(domains),
    Layer.provide(execution(runtime, providers)),
    // A workspace's provider account, templates and installations live in the shared database.
    Layer.provide(Layer.mergeAll(Templates.layer, Compute.credentials, Credentials.layer)),
    Layer.provide([
      Layer.succeed(SharedDb.Service, shared),
      Layer.succeed(ConnectionObject.Remote, connections),
      Sealed.layer(key),
      cryptoLayer,
    ]),
    // A malformed key or a platform registered twice is a deployment defect.
    Layer.orDie,
  );

  return Effect.service(Service).pipe(Effect.provide(object));
});

export * as TaskObject from "./task";
