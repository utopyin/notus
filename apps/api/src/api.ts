import { Api as Control } from "@notus/control/api";
import { Drain } from "@notus/control/drain";
import { SharedDb } from "@notus/db/shared";
import { hostnames, zone } from "@notus/shared/hosts";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Auth from "./auth";
import * as Build from "./build";
import * as Connection from "./connection";
import * as Task from "./task";

/** What the control plane leaves to this Worker: its database, its sign-in and its objects. */
const platform = Layer.mergeAll(
  SharedDb.layer,
  Auth.sessions.pipe(Layer.provideMerge(Auth.layer)),
  Task.remote,
  Connection.remote,
  Build.remote,
);

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  Stack.useSync(({ stage }) => ({
    main: import.meta.url,
    domain: { name: hostnames(stage).api, zoneName: zone },
    // One origin per stage: no workers.dev name beside the custom domain.
    workersDev: false,
  })),
  Effect.gen(function* () {
    const drain = yield* Drain.Service;

    yield* Cloudflare.Workers.cron("* * * * *", () => drain.run);

    return {
      fetch: yield* HttpRouter.toHttpEffect(Layer.merge(Control.routes, Auth.routes)),
    };
  }).pipe(
    Effect.provide(
      Layer.merge(
        Control.layer.pipe(Layer.provideMerge(platform)),
        Cloudflare.Workers.CronEventSourceLive,
      ),
    ),
  ),
) {}
