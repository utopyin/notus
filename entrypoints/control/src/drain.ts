import { Environments } from "@notus/workspaces/environments";
import { Roles } from "@notus/workspaces/roles";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Inbox } from "./inbox";
import { TaskObject } from "./objects/task";

/**
 * One pass over the durable inbox: due admissions forwarded to their task objects, with the
 * workspace's environment, repositories and roles for a task that has none yet. The schedule
 * runs it every minute; an admission kicks it once its response is sent.
 */
const make = Effect.gen(function* () {
  const inbox = yield* Inbox.Service;
  const tasks = yield* TaskObject.Remote;
  const environments = yield* Environments.Service;
  const roles = yield* Roles.Service;

  // Its own scope, so a pass never retains the D1 client of the event that started it.
  const run = Effect.scoped(
    inbox.drain((command) =>
      Effect.gen(function* () {
        const task = tasks(command.reservation.taskId);
        const result = yield* task.admit(command);

        if (!result.ok) return yield* Effect.fail("task_admission_rejected");

        if (result.needsEnvironment) {
          const environment = yield* environments.get(command.reservation.workspaceId);

          // What the workspace covers now; the task keeps this list and chooses from it.
          const repositories = yield* inbox.repositories(
            command.reservation.workspaceId,
            command.reservation.initiatorId,
          );

          const prepared = yield* task.prepareEnvironment(
            Option.getOrNull(environment),
            repositories,
            yield* roles.resolve(command.reservation.workspaceId),
          );

          if (!prepared.ok) return yield* Effect.fail("task_configuration_rejected");
        }
      }),
    ),
  ).pipe(
    Effect.flatMap((counts) => Effect.logInfo("inbox.drain", counts)),
    Effect.catch(() => Effect.logError("inbox.drain_failed")),
    // The platform's schedule wrapper catches defects; log before that boundary.
    Effect.tapCause(() => Effect.logError("inbox.drain_defect")),
  );

  return { run };
});

export interface Interface extends Effect.Success<typeof make> {}

export class Service extends Context.Service<Service, Interface>()("@notus/control/Drain") {}

export const layer = Layer.effect(Service, make);

export * as Drain from "./drain";
