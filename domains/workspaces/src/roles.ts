import { SharedDb } from "@notus/db/shared";
import { key } from "@notus/platform/source";
import { desc, eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defaultRoles } from "./defaults";
import { WorkspaceError } from "./errors";
import { memberships, roleRevisions, roles } from "@notus/db/schema/shared";
import {
  ResolvedInstructions,
  RoleBody,
  RoleName,
  RoleRevision,
  RoleSummary,
  SpecialistRole,
} from "./types";

/**
 * The specialist roles a workspace's agents follow. Members read them, admins write them, and a
 * task captures `resolve` once when it starts so later edits never change work in flight.
 */
export interface Interface {
  readonly list: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<ReadonlyArray<SpecialistRole>, WorkspaceError>;
  /** Every revision of one role, newest first. */
  readonly history: (
    workspaceId: string,
    userId: string,
    name: string,
  ) => Effect.Effect<ReadonlyArray<RoleRevision>, WorkspaceError>;
  /** Creates or replaces the text; every save is a new revision, even an unchanged one. */
  readonly save: (
    workspaceId: string,
    actorId: string,
    name: string,
    summary: string,
    body: string,
    now: number,
  ) => Effect.Effect<SpecialistRole, WorkspaceError>;
  readonly remove: (
    workspaceId: string,
    actorId: string,
    name: string,
  ) => Effect.Effect<void, WorkspaceError>;
  /** Host-trusted: what a task starting in this workspace captures. */
  readonly resolve: (workspaceId: string) => Effect.Effect<ResolvedInstructions, WorkspaceError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/roles/Service",
) {}

const Row = createSelectSchema(roles);
const RevisionRow = createSelectSchema(roleRevisions);
const MemberRow = createSelectSchema(memberships);

const fail = (operation: string, reason: WorkspaceError["reason"]) =>
  new WorkspaceError({ operation, reason });

/** The rows a new workspace starts with; the creator is their author. Part of the creating batch. */
export const defaultRoleStatements = (workspaceId: string, actorId: string, now: number) =>
  defaultRoles.flatMap((role) => {
    const roleKey = key(workspaceId, role.name);

    return [
      sql`INSERT INTO workspace_roles (key, workspaceId, name, summary, body, revision, authorId, createdAt, updatedAt)
      VALUES (${roleKey}, ${workspaceId}, ${role.name}, ${role.summary}, ${role.body}, 1, ${actorId}, ${now}, ${now})`,
      sql`INSERT INTO workspace_role_revisions (key, roleKey, revision, summary, body, authorId, createdAt)
      VALUES (${JSON.stringify([roleKey, 1])}, ${roleKey}, 1, ${role.summary}, ${role.body}, ${actorId}, ${now})`,
    ];
  });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SharedDb.Service;

    const storage =
      (operation: string) =>
      <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError((error) =>
            Schema.is(WorkspaceError)(error)
              ? error
              : fail(operation, Schema.isSchemaError(error) ? "invalid-input" : "storage"),
          ),
        );

    const decodeInput = <A, I>(schema: Schema.Codec<A, I>, value: I, operation: string) =>
      Schema.decodeEffect(schema)(value).pipe(
        Effect.mapError(() => fail(operation, "invalid-input")),
      );

    const roleOf = (operation: string, workspaceId: string, userId: string) =>
      store.db
        .select()
        .from(memberships)
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))),
          storage(operation),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(fail(operation, "forbidden"))
              : Effect.succeed(rows[0].role),
          ),
        );

    const requireAdmin = (operation: string, workspaceId: string, actorId: string) =>
      roleOf(operation, workspaceId, actorId).pipe(
        Effect.flatMap((role) =>
          role === "admin" ? Effect.void : Effect.fail(fail(operation, "forbidden")),
        ),
      );

    const rowsOf = (operation: string, workspaceId: string) =>
      store.db
        .select()
        .from(roles)
        .where(eq(roles.workspaceId, workspaceId))
        .orderBy(roles.createdAt, roles.name)
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.flatMap(Schema.decodeEffect(Schema.Array(SpecialistRole))),
          storage(operation),
        );

    const list = Effect.fn("Roles.list")(function* (workspaceId: string, userId: string) {
      yield* roleOf("list", workspaceId, userId);
      return yield* rowsOf("list", workspaceId);
    });

    const history = Effect.fn("Roles.history")(function* (
      workspaceId: string,
      userId: string,
      name: string,
    ) {
      yield* roleOf("history", workspaceId, userId);

      const rows = yield* store.db
        .select()
        .from(roleRevisions)
        .where(eq(roleRevisions.roleKey, key(workspaceId, name)))
        .orderBy(desc(roleRevisions.revision))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(RevisionRow))),
          storage("history"),
        );

      return rows.map((row) =>
        RoleRevision.make({
          revision: row.revision,
          summary: row.summary,
          body: row.body,
          authorId: row.authorId,
          createdAt: row.createdAt,
        }),
      );
    });

    const save = Effect.fn("Roles.save")(function* (
      workspaceId: string,
      actorId: string,
      nameValue: string,
      summaryValue: string,
      bodyValue: string,
      now: number,
    ) {
      const name = yield* decodeInput(RoleName, nameValue.trim(), "save");
      const summary = yield* decodeInput(RoleSummary, summaryValue.trim(), "save");
      const body = yield* decodeInput(RoleBody, bodyValue, "save");

      yield* requireAdmin("save", workspaceId, actorId);
      const roleKey = key(workspaceId, name);

      // One batch: the current text moves on and the revision it became is recorded from the
      // same row, so the revision number is never guessed by the caller.
      yield* store
        .batch([
          sql`INSERT INTO workspace_roles (key, workspaceId, name, summary, body, revision, authorId, createdAt, updatedAt)
          VALUES (${roleKey}, ${workspaceId}, ${name}, ${summary}, ${body}, 1, ${actorId}, ${now}, ${now})
          ON CONFLICT(key) DO UPDATE SET summary = excluded.summary, body = excluded.body,
          revision = workspace_roles.revision + 1, authorId = excluded.authorId, updatedAt = excluded.updatedAt`,
          sql`INSERT INTO workspace_role_revisions (key, roleKey, revision, summary, body, authorId, createdAt)
          SELECT json_array(key, revision), key, revision, summary, body, authorId, updatedAt
          FROM workspace_roles WHERE key = ${roleKey}`,
        ])
        .pipe(storage("save"));

      const rows = yield* store.db
        .select()
        .from(roles)
        .where(eq(roles.key, roleKey))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.flatMap(Schema.decodeEffect(Schema.Array(SpecialistRole))),
          storage("save"),
        );
      const row = rows[0];
      if (!row) return yield* fail("save", "storage");
      return row;
    });

    const remove = Effect.fn("Roles.remove")(function* (
      workspaceId: string,
      actorId: string,
      name: string,
    ) {
      yield* requireAdmin("remove", workspaceId, actorId);
      const roleKey = key(workspaceId, name);
      yield* store
        .batch([
          sql`DELETE FROM workspace_role_revisions WHERE roleKey = ${roleKey}`,
          sql`DELETE FROM workspace_roles WHERE key = ${roleKey} AND workspaceId = ${workspaceId}`,
        ])
        .pipe(storage("remove"));
    });

    const resolve = Effect.fn("Roles.resolve")(function* (workspaceId: string) {
      const rows = yield* rowsOf("resolve", workspaceId);

      return yield* Schema.decodeEffect(ResolvedInstructions)({
        roles: rows.map((row) => ({
          name: row.name,
          revision: row.revision,
          summary: row.summary,
          body: row.body,
        })),
      }).pipe(storage("resolve"));
    });

    return Service.of({ list, history, save, remove, resolve });
  }),
);
export const layer = layerNoDeps;
export * as Roles from "./roles";
