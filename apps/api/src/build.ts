import { BuildObject } from "@notus/control/objects/build";
import { SharedDb } from "@notus/db/shared";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Durable from "./durable";
import * as Recipe from "./recipe";

/** Builds the Notus template in one workspace's own provider account, addressed by `workspaceId:provider`. */
export class Build extends Cloudflare.DurableObject<Build>()(
  "Build",
  Effect.gen(function* () {
    const object = yield* BuildObject.make;
    return object.pipe(Effect.provide([Durable.layer, Recipe.layer]));
  }).pipe(Effect.provide(SharedDb.layer), Effect.orDie),
) {}

export const remote = Layer.effect(
  BuildObject.Remote,
  Effect.map(Build, (objects) => (key) => objects.getByName(key)),
);
