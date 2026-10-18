import { ConnectionObject } from "@notus/control/objects/connection";
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
    const object = yield* ConnectionObject.make;
    return object.pipe(Effect.provide([ConnectionDb.layer, Durable.layer]));
  }).pipe(Effect.provide(SharedDb.layer), Effect.orDie),
) {}

/** The namespace, for the Worker and the objects that call a user's Connection. */
export const remote = Layer.effect(
  ConnectionObject.Remote,
  Effect.map(Connection, (objects) => (userId) => objects.getByName(userId)),
);
