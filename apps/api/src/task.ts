import { TaskObject } from "@notus/control/objects/task";
import { SharedDb } from "@notus/db/shared";
import { TaskDb } from "@notus/db/task";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Connection from "./connection";
import * as Durable from "./durable";
import * as Recipe from "./recipe";

/** One task's record and operator loop, addressed by task ID. */
export class Task extends Cloudflare.DurableObject<Task>()(
  "Task",
  Effect.gen(function* () {
    const object = yield* TaskObject.make;
    return object.pipe(Effect.provide([TaskDb.layer, Durable.layer, Recipe.layer]));
  }).pipe(Effect.provide([SharedDb.layer, Connection.remote]), Effect.orDie),
) {}

export const remote = Layer.effect(
  TaskObject.Remote,
  Effect.map(Task, (objects) => (taskId) => objects.getByName(taskId)),
);
