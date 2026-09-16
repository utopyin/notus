import { D1 } from "@notus/cloudflare/d1";
import { key } from "@notus/platform/source";
import { desc, eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defaultRoles } from "./defaults";
import { WorkspaceError } from "./errors";
import { instructionRevisions, instructions, memberships } from "./schema";
import {
  Instruction,
  InstructionBody,
  InstructionKind,
  InstructionRevision,
  RepositoryName,
  ResolvedInstructions,
  RoleName,
} from "./types";

/**
 * The Markdown a workspace's agents follow. Members read it, admins write it, and a task captures
 * `resolve` once when it starts so later edits never change work in flight.
 */
export interface Interface {
  readonly list: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<ReadonlyArray<Instruction>, WorkspaceError>;
  /** Every revision of one instruction, newest first. */
  readonly history: (
    workspaceId: string,
    userId: string,
    kind: InstructionKind,
    name: string,
  ) => Effect.Effect<ReadonlyArray<InstructionRevision>, WorkspaceError>;
  /** Creates or replaces the text; every save is a new revision, even an unchanged one. */
  readonly save: (
    workspaceId: string,
    actorId: string,
    kind: InstructionKind,
    name: string,
    body: string,
    now: number,
  ) => Effect.Effect<Instruction, WorkspaceError>;
  readonly remove: (
    workspaceId: string,
    actorId: string,
    kind: InstructionKind,
    name: string,
  ) => Effect.Effect<void, WorkspaceError>;
  /** Host-trusted: what a task starting in this workspace captures. */
  readonly resolve: (workspaceId: string) => Effect.Effect<ResolvedInstructions, WorkspaceError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/instructions/Service",
) {}

const Row = createSelectSchema(instructions);
const RevisionRow = createSelectSchema(instructionRevisions);
const MemberRow = createSelectSchema(memberships);
const fail = (operation: string, reason: WorkspaceError["reason"]) =>
  new WorkspaceError({ operation, reason });
const nameSchema = (kind: InstructionKind) => (kind === "role" ? RoleName : RepositoryName);

/** The rows a new workspace starts with; the creator is their author. Part of the creating batch. */
export const defaultRoleStatements = (workspaceId: string, actorId: string, now: number) =>
  defaultRoles.flatMap((role) => {
    const instructionKey = key(workspaceId, "role", role.name);
    return [
      sql`INSERT INTO workspace_instructions (key, workspaceId, kind, name, body, revision, authorId, createdAt, updatedAt)
      VALUES (${instructionKey}, ${workspaceId}, 'role', ${role.name}, ${role.body}, 1, ${actorId}, ${now}, ${now})`,
      sql`INSERT INTO workspace_instruction_revisions (key, instructionKey, revision, body, authorId, createdAt)
      VALUES (${JSON.stringify([instructionKey, 1])}, ${instructionKey}, 1, ${role.body}, ${actorId}, ${now})`,
    ];
  });

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* D1.Service;
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
        .from(instructions)
        .where(eq(instructions.workspaceId, workspaceId))
        .orderBy(instructions.kind, instructions.createdAt)
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Instruction))),
          storage(operation),
        );

    const list = Effect.fn("Instructions.list")(function* (workspaceId: string, userId: string) {
      yield* roleOf("list", workspaceId, userId);
      return yield* rowsOf("list", workspaceId);
    });

    const history = Effect.fn("Instructions.history")(function* (
      workspaceId: string,
      userId: string,
      kind: InstructionKind,
      name: string,
    ) {
      yield* roleOf("history", workspaceId, userId);
      const rows = yield* store.db
        .select()
        .from(instructionRevisions)
        .where(eq(instructionRevisions.instructionKey, key(workspaceId, kind, name)))
        .orderBy(desc(instructionRevisions.revision))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(RevisionRow))),
          storage("history"),
        );
      return rows.map((row) =>
        InstructionRevision.make({
          revision: row.revision,
          body: row.body,
          authorId: row.authorId,
          createdAt: row.createdAt,
        }),
      );
    });

    const save = Effect.fn("Instructions.save")(function* (
      workspaceId: string,
      actorId: string,
      kindValue: InstructionKind,
      nameValue: string,
      bodyValue: string,
      now: number,
    ) {
      const kind = yield* decodeInput(InstructionKind, kindValue, "save");
      const name = yield* decodeInput(nameSchema(kind), nameValue.trim(), "save");
      const body = yield* decodeInput(InstructionBody, bodyValue, "save");
      yield* requireAdmin("save", workspaceId, actorId);
      const instructionKey = key(workspaceId, kind, name);
      // One batch: the current text moves on and the revision it became is recorded from the
      // same row, so the revision number is never guessed by the caller.
      yield* store
        .batch([
          sql`INSERT INTO workspace_instructions (key, workspaceId, kind, name, body, revision, authorId, createdAt, updatedAt)
          VALUES (${instructionKey}, ${workspaceId}, ${kind}, ${name}, ${body}, 1, ${actorId}, ${now}, ${now})
          ON CONFLICT(key) DO UPDATE SET body = excluded.body, revision = workspace_instructions.revision + 1,
          authorId = excluded.authorId, updatedAt = excluded.updatedAt`,
          sql`INSERT INTO workspace_instruction_revisions (key, instructionKey, revision, body, authorId, createdAt)
          SELECT json_array(key, revision), key, revision, body, authorId, updatedAt
          FROM workspace_instructions WHERE key = ${instructionKey}`,
        ])
        .pipe(storage("save"));
      const rows = yield* store.db
        .select()
        .from(instructions)
        .where(eq(instructions.key, instructionKey))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Instruction))),
          storage("save"),
        );
      const row = rows[0];
      if (!row) return yield* fail("save", "storage");
      return row;
    });

    const remove = Effect.fn("Instructions.remove")(function* (
      workspaceId: string,
      actorId: string,
      kind: InstructionKind,
      name: string,
    ) {
      yield* requireAdmin("remove", workspaceId, actorId);
      const instructionKey = key(workspaceId, kind, name);
      yield* store
        .batch([
          sql`DELETE FROM workspace_instruction_revisions WHERE instructionKey = ${instructionKey}`,
          sql`DELETE FROM workspace_instructions WHERE key = ${instructionKey} AND workspaceId = ${workspaceId}`,
        ])
        .pipe(storage("remove"));
    });

    const resolve = Effect.fn("Instructions.resolve")(function* (workspaceId: string) {
      const rows = yield* rowsOf("resolve", workspaceId);
      return yield* Schema.decodeEffect(ResolvedInstructions)({
        roles: rows
          .filter((row) => row.kind === "role")
          .map((row) => ({ name: row.name, revision: row.revision, body: row.body })),
        repositories: rows
          .filter((row) => row.kind === "repository")
          .map((row) => ({ fullName: row.name, revision: row.revision, body: row.body })),
      }).pipe(storage("resolve"));
    });

    return Service.of({ list, history, save, remove, resolve });
  }),
);
export const layer = layerNoDeps.pipe(Layer.provide(D1.layer));
export * as Instructions from "./instructions";
