import {
  computeConfig,
  credentialKeyConfig,
  deploymentConfig,
  githubConfig,
  operatorConfig,
  runtimeConfig,
} from "@notus/control/config";
import { ConnectionHost } from "@notus/control/hosts/connection";
import { TaskHost } from "@notus/control/hosts/task";
import { Sealed } from "@notus/cloudflare/sealed";
import { SharedDb } from "@notus/db/shared";
import { TaskDb } from "@notus/db/task";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Connection } from "./connection";
import * as Durable from "./durable";
import * as Recipe from "./recipe";

/** One task's record and operator loop, addressed by task ID. */
export class Task extends Cloudflare.DurableObject<Task>()(
  "Task",
  Effect.gen(function* () {
    const deployment = yield* deploymentConfig.pipe(Effect.orDie);
    const runtime = yield* runtimeConfig.pipe(Effect.orDie);

    if (deployment.mode === "readiness" && !runtime)
      return yield* Effect.die("Readiness mode requires runtime authentication configuration");

    const settings: TaskHost.Settings = {
      deployment,
      runtime,
      operator: yield* operatorConfig.pipe(Effect.orDie),
      github: yield* githubConfig.pipe(Effect.orDie),
      providers: yield* computeConfig.pipe(Effect.orDie),
    };

    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    // Model requests leave this object only through the initiator's Connection object.
    const connections = yield* Connection;
    // Deliveries act for an installation, whose credential the shared database holds.
    const shared = yield* SharedDb.Service;

    const host = TaskHost.layer(settings).pipe(
      Layer.provide([
        TaskDb.layer,
        Durable.layer,
        Layer.succeed(SharedDb.Service, shared),
        Layer.succeed(ConnectionHost.Remote, (userId) => connections.getByName(userId)),
        Sealed.layer(credentialKey),
        Recipe.layer,
      ]),
      // A malformed key or a platform registered twice is a deployment defect.
      Layer.orDie,
    );

    return TaskHost.Service.pipe(Effect.provide(host));
  }).pipe(Effect.provide(SharedDb.layer)),
) {}
