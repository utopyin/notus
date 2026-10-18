import { credentialKeyConfig, dashboardConfig } from "@notus/control/config";
import { ConnectionHost } from "@notus/control/hosts/connection";
import { Sealed } from "@notus/cloudflare/sealed";
import { ConnectionDb } from "@notus/db/connection";
import { SharedDb } from "@notus/db/shared";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Durable from "./durable";

/**
 * One user's saved model logins, addressed by user ID. Only this object opens provider material.
 * Callers receive status, a device code to type, or forwarded provider responses, never credentials.
 */
export class Connection extends Cloudflare.DurableObject<Connection>()(
  "Connection",
  Effect.gen(function* () {
    const credentialKey = yield* credentialKeyConfig.pipe(Effect.orDie);
    // GitHub sign-ins and the users they act as both live in the shared database.
    const dashboard = yield* dashboardConfig.pipe(Effect.orDie);
    const shared = yield* SharedDb.Service;

    const host = ConnectionHost.layer({ github: dashboard.github }).pipe(
      Layer.provide([
        ConnectionDb.layer,
        Durable.layer,
        Layer.succeed(SharedDb.Service, shared),
        Sealed.layer(credentialKey),
      ]),
      // A malformed sealing key is a deployment defect.
      Layer.orDie,
    );

    return ConnectionHost.Service.pipe(Effect.provide(host));
  }).pipe(Effect.provide(SharedDb.layer)),
) {}
