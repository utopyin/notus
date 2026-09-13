import { D1 } from "@notus/cloudflare/d1";
import { Inbox } from "@notus/control/inbox";
import { Environments } from "@notus/workspaces/environments";
import * as Cloudflare from "alchemy/Cloudflare";
import { CurrentRuntimeContext, RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Callback from "./callback";
import { deploymentConfig, runtimeConfig } from "./config";
import * as RuntimeLayers from "./runtime";
import { cryptoLayer } from "./crypto";
import { SharedDatabase } from "./database";
import { handler } from "./http";
import { Task } from "./task";

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  { main: import.meta.url },
  Effect.gen(function* () {
    const config = yield* deploymentConfig;
    const callbackSettings = yield* runtimeConfig.pipe(Effect.orDie);
    const tasks = yield* Task;
    const database = yield* SharedDatabase;
    const binding = yield* Cloudflare.D1.QueryDatabase(database);
    const execution = yield* Cloudflare.WorkerExecutionContext;
    // Alchemy supplies this during initialization, not in event contexts.
    const runtime = yield* CurrentRuntimeContext;
    if (!runtime) return yield* Effect.die("Api initialization requires Alchemy RuntimeContext");
    // Build this graph in each execution, never in the isolate constructor.
    // A waitUntil pass opens its own scope rather than retaining fetch's D1 client.
    const inboxLayer = Layer.merge(Inbox.layer, Environments.layer).pipe(
      Layer.provide([Layer.effect(D1.Binding, binding.raw), cryptoLayer]),
    );
    const withInbox = <A, E, R>(run: (inbox: Inbox.Interface) => Effect.Effect<A, E, R>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const inbox = yield* Inbox.Service;
          yield* inbox.seedFixture(config);
          return yield* run(inbox);
        }).pipe(Effect.provide(inboxLayer)),
      );
    const drain = withInbox((inbox) =>
      Effect.gen(function* () {
        const environments = yield* Environments.Service;
        return yield* inbox.drain((command) =>
          Effect.gen(function* () {
            const task = tasks.getByName(command.reservation.taskId);
            const result = yield* task.admit(command);
            if (!result.ok) return yield* Effect.fail("task_admission_rejected");
            if (result.needsEnvironment) {
              const environment = yield* environments.get(command.reservation.workspaceId);
              const prepared = yield* task.prepareEnvironment(Option.getOrNull(environment));
              if (!prepared.ok) return yield* Effect.fail("task_configuration_rejected");
            }
          }).pipe(Effect.provideService(RuntimeContext, runtime)),
        );
      }),
    ).pipe(
      Effect.flatMap((counts) => Effect.logInfo("inbox.drain", counts)),
      Effect.catch(() => Effect.logError("inbox.drain_failed")),
      // Alchemy's cron wrapper catches defects; log before that boundary.
      Effect.tapCause(() => Effect.logError("inbox.drain_defect")),
    );
    yield* Cloudflare.Workers.cron("* * * * *", () => drain);
    const callback = Callback.handler((capability, request) => {
      const task = tasks.getByName(capability.bootstrap.taskId);
      switch (request._tag) {
        case "Assignment":
          return task.runtimeAssignment(capability);
        case "Enroll":
          return task.runtimeEnroll(capability, request.request);
        case "Ready":
          return task.runtimeReady(capability, request.request);
      }
    }).pipe(
      Effect.provide(RuntimeLayers.authentication(callbackSettings)),
      Effect.provideService(RuntimeContext, runtime),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 })),
    );
    const slack = handler(
      config,
      (input) => withInbox((inbox) => inbox.admit(input)),
      execution.waitUntil(drain),
    );
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://notus.invalid").pathname;
        return yield* path.startsWith("/runtime/") ? callback : slack;
      }),
      // Binding RPC only. No fetch route exposes task state or seed authority.
      snapshot: (taskId: string) => tasks.getByName(taskId).snapshot(),
      inboxSnapshot: () => withInbox((inbox) => inbox.snapshot(config.workspaceId)),
      configureEnvironment: (provider: string, environment: Schema.Json) =>
        withInbox(() =>
          Effect.gen(function* () {
            const environments = yield* Environments.Service;
            const stored = yield* environments.set(config.workspaceId, provider, environment);
            return {
              workspaceId: stored.workspaceId,
              provider: stored.provider,
              revision: stored.revision,
            };
          }),
        ),
    };
  }).pipe(
    Effect.provide([Cloudflare.D1.QueryDatabaseBinding, Cloudflare.Workers.CronEventSourceLive]),
  ),
) {}
