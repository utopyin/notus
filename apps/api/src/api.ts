import {
  computeConfig,
  credentialKeyConfig,
  dashboardConfig,
  deploymentConfig,
  githubConfig,
  runtimeConfig,
  webhookConfig,
} from "@notus/control/config";
import { ApiHost } from "@notus/control/hosts/api";
import { BuildHost } from "@notus/control/hosts/build";
import { ConnectionHost } from "@notus/control/hosts/connection";
import { Sessions } from "@notus/control/hosts/sessions";
import { TaskHost } from "@notus/control/hosts/task";
import { Sealed } from "@notus/cloudflare/sealed";
import { SharedDb } from "@notus/db/shared";
import { hostnames, zone } from "@notus/shared/hosts";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { authDatabase, makeAuth, sessions } from "./auth";
import { Build } from "./build";
import { Connection } from "./connection";
import { Task } from "./task";

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  Stack.useSync(({ stage }) => ({
    main: import.meta.url,
    domain: { name: hostnames(stage).api, zoneName: zone },
    // One origin per stage: no workers.dev name beside the custom domain.
    workersDev: false,
  })),
  Effect.gen(function* () {
    const settings: ApiHost.Settings = {
      deployment: yield* deploymentConfig,
      runtime: yield* runtimeConfig.pipe(Effect.orDie),
      github: yield* githubConfig.pipe(Effect.orDie),
      webhookSecret: yield* webhookConfig.pipe(Effect.orDie),
      dashboard: yield* dashboardConfig.pipe(Effect.orDie),
      providers: yield* computeConfig.pipe(Effect.orDie),
    };

    // Every credential at rest, model login or platform installation, is sealed under this key.
    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    // Sign-in for the dashboard. Sessions are validated here, never trusted from the dashboard.
    const auth = yield* makeAuth(settings.dashboard);
    const tasks = yield* Task;
    const connections = yield* Connection;
    const builds = yield* Build;
    const execution = yield* Cloudflare.WorkerExecutionContext;

    const host = ApiHost.layer(settings).pipe(
      Layer.provide([
        Layer.succeed(SharedDb.Service, yield* SharedDb.Service),
        Sealed.layer(credentialKey),
        Layer.succeed(Sessions.Service, sessions(auth)),
        Layer.succeed(ApiHost.Background, { run: (effect) => execution.waitUntil(effect) }),
        Layer.succeed(TaskHost.Remote, (taskId) => tasks.getByName(taskId)),
        Layer.succeed(ConnectionHost.Remote, (userId) => connections.getByName(userId)),
        Layer.succeed(BuildHost.Remote, (key) => builds.getByName(key)),
      ]),
      // A malformed key or a platform registered twice is a deployment defect.
      Layer.orDie,
    );

    const api = yield* ApiHost.Service.pipe(Effect.provide(host));

    yield* Cloudflare.Workers.cron("* * * * *", () => api.drain);

    return api.worker;
  }).pipe(Effect.provide([SharedDb.layer, Cloudflare.Workers.CronEventSourceLive, authDatabase])),
) {}
