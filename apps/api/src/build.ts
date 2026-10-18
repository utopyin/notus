import { BuildHost } from "@notus/control/hosts/build";
import { computeConfig, credentialKeyConfig } from "@notus/control/config";
import { Sealed } from "@notus/cloudflare/sealed";
import { SharedDb } from "@notus/db/shared";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Durable from "./durable";
import * as Recipe from "./recipe";

export type { BuildView } from "@notus/control/hosts/build";

/** Builds the Notus template in one workspace's own provider account, addressed by `workspaceId:provider`. */
export class Build extends Cloudflare.DurableObject<Build>()(
  "Build",
  Effect.gen(function* () {
    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    const providers = yield* computeConfig.pipe(Effect.orDie);
    const shared = yield* SharedDb.Service;

    const host = BuildHost.layer(providers).pipe(
      Layer.provide([
        Durable.layer,
        Layer.succeed(SharedDb.Service, shared),
        Sealed.layer(credentialKey),
        Recipe.layer,
      ]),
      // A malformed sealing key or a provider registered twice is a deployment defect.
      Layer.orDie,
    );

    return BuildHost.Service.pipe(Effect.provide(host));
  }).pipe(Effect.provide(SharedDb.layer)),
) {}
