import { Identities } from "@notus/accounts/identities";
import type { Profile } from "@notus/accounts/types";
import { Roles } from "@notus/workspaces/roles";
import { Workspaces } from "@notus/workspaces/workspaces";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Inbox } from "../inbox";
import { TaskObject } from "../objects/task";
import { RoleRpcs, TaskRpcs, Viewer } from "./rpcs";
import { refusal, refuse } from "./viewers";

/** How many of a workspace's latest tasks the list reads, one object call each. */
const listLimit = 50;

const initiatorOf = (
  profiles: ReadonlyMap<string, Profile>,
  task: { readonly initiatorId: string },
) => {
  const profile = profiles.get(task.initiatorId);
  return profile ? { name: profile.name, image: profile.image } : null;
};

/** A workspace's tasks, each read from its own object; members see every task of the workspace. */
export const tasks = TaskRpcs.toLayer(
  Effect.gen(function* () {
    const workspaces = yield* Workspaces.Service;
    const identities = yield* Identities.Service;
    const inbox = yield* Inbox.Service;
    const objects = yield* TaskObject.Remote;

    return {
      /** Newest first, each row as live as its task. */
      tasks: ({ workspaceId }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;

          yield* workspaces.role(workspaceId, me.userId);

          const refs = yield* inbox.tasks(workspaceId, listLimit);

          const rows = yield* Effect.forEach(
            refs,
            (ref) =>
              objects(ref.taskId)
                .summary()
                .pipe(Effect.orElseSucceed(() => null)),
            { concurrency: 8 },
          );
          const listed = rows.filter(
            (row): row is NonNullable<typeof row> =>
              row !== null && row.workspaceId === workspaceId,
          );

          const profiles = yield* identities.profiles([
            ...new Set(listed.map((row) => row.initiatorId)),
          ]);

          return listed.map((row) =>
            // oxlint-disable-next-line typescript/no-misused-spread -- object replies are plain values.
            ({ ...row, initiator: initiatorOf(profiles, row) }),
          );
        }).pipe(refuse),
      /** One task with its whole timeline, for a member of the workspace it belongs to. */
      task: ({ workspaceId, taskId }) =>
        Effect.gen(function* () {
          const me = yield* Viewer;

          yield* workspaces.role(workspaceId, me.userId);

          // Only tasks routed in this workspace are opened, so no object is created for a guess.
          const detail = (yield* inbox.owns(workspaceId, taskId))
            ? yield* objects(taskId).view()
            : null;

          if (detail === null || detail.workspaceId !== workspaceId)
            return yield* refusal("not-found");

          const profiles = yield* identities.profiles([detail.initiatorId]);

          // oxlint-disable-next-line typescript/no-misused-spread -- object replies are plain values.
          return { ...detail, initiator: initiatorOf(profiles, detail) };
        }).pipe(refuse),
    };
  }),
);

/** The workspace's specialist roles: current text and revision each. */
export const roles = RoleRpcs.toLayer(
  Effect.gen(function* () {
    const roles = yield* Roles.Service;

    return {
      roles: ({ workspaceId }) =>
        refuse(Effect.flatMap(Viewer, (me) => roles.list(workspaceId, me.userId))),
      roleHistory: ({ workspaceId, name }) =>
        refuse(Effect.flatMap(Viewer, (me) => roles.history(workspaceId, me.userId, name))),
      saveRole: ({ workspaceId, name, summary, body }) =>
        refuse(
          Effect.flatMap(Viewer, (me) =>
            roles.save(workspaceId, me.userId, name, summary, body, me.now),
          ),
        ),
      deleteRole: ({ workspaceId, name }) =>
        refuse(Effect.flatMap(Viewer, (me) => roles.remove(workspaceId, me.userId, name))),
    };
  }),
);

export const layer = Layer.mergeAll(tasks, roles);
