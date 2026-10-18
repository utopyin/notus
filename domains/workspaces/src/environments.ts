import { SharedDb } from "@notus/db/shared";
import { snapshot as snapshotJson } from "@notus/contracts/json";
import { key } from "@notus/platform/source";
import { desc, eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { EnvironmentError } from "./errors";
import { environmentRevisions, environments, memberships } from "@notus/db/schema/shared";
import { Environment, EnvironmentRevision } from "./types";

/**
 * The workspace's default devbox configuration. `get` and `set` are host-trusted and carry no
 * authorization; `view`, `history` and `save` are gated on membership like the roles are.
 * Providers alone interpret config and resolve secret references; this service stores JSON.
 * Every write, trusted or not, is a revision, so a change can be traced and put back.
 */
export interface Interface {
  readonly get: (
    workspaceId: string,
  ) => Effect.Effect<Option.Option<Environment>, EnvironmentError>;
  /** Replaces the default, incrementing its revision even when the values are unchanged. */
  readonly set: (
    workspaceId: string,
    provider: string,
    config: Schema.Json,
    now: number,
  ) => Effect.Effect<Environment, EnvironmentError>;
  readonly view: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<Option.Option<Environment>, EnvironmentError>;
  /** Every revision, newest first. */
  readonly history: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<ReadonlyArray<EnvironmentRevision>, EnvironmentError>;
  /** An admin's save: the caller has validated the JSON against the provider's policy already. */
  readonly save: (
    workspaceId: string,
    actorId: string,
    provider: string,
    config: Schema.Json,
    now: number,
  ) => Effect.Effect<Environment, EnvironmentError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/environments/Service",
) {}

const Input = Schema.Struct({
  workspaceId: Environment.fields.workspaceId,
  provider: Environment.fields.provider,
  config: Environment.fields.config,
});

const ConfigText = Schema.fromJsonString(Environment.fields.config);

const Row = createSelectSchema(environments, {
  ...Environment.fields,
  config: ConfigText,
});
const RevisionRow = createSelectSchema(environmentRevisions, {
  ...EnvironmentRevision.fields,
  config: ConfigText,
});
const MemberRow = createSelectSchema(memberships);

type Operation = EnvironmentError["operation"];

const fail = (operation: Operation, reason: EnvironmentError["reason"]) =>
  new EnvironmentError({ operation, reason });

// Rows have just been parsed from stored JSON. Freeze them without freezing caller-owned input.
// Keep snapshots independent of subsequent edits.
const freeze = (config: Schema.Json) => {
  const pending: Array<Schema.Json> = [config];

  while (pending.length > 0) {
    const current = pending.pop();

    if (typeof current === "object" && current !== null) {
      for (const child of Object.values(current)) pending.push(child);
      Object.freeze(current);
    }
  }
};

const snapshot = (value: Environment): Environment => {
  freeze(value.config);
  return Object.freeze(value);
};

const snapshotRevision = (value: EnvironmentRevision): EnvironmentRevision => {
  freeze(value.config);
  return Object.freeze(value);
};

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SharedDb.Service;

    const storage =
      (operation: Operation) =>
      <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError((error) =>
            Schema.is(EnvironmentError)(error)
              ? error
              : fail(operation, Schema.isSchemaError(error) ? "invalid-record" : "storage"),
          ),
        );

    const roleOf = (operation: Operation, workspaceId: string, userId: string) =>
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

    const requireAdmin = (operation: Operation, workspaceId: string, actorId: string) =>
      roleOf(operation, workspaceId, actorId).pipe(
        Effect.flatMap((role) =>
          role === "admin" ? Effect.void : Effect.fail(fail(operation, "forbidden")),
        ),
      );

    const read = (operation: Operation, workspaceId: string) =>
      Effect.gen(function* () {
        const id = yield* Schema.decodeEffect(Environment.fields.workspaceId)(workspaceId).pipe(
          Effect.mapError(() => fail(operation, "invalid-input")),
        );

        const rows = yield* store.db
          .select()
          .from(environments)
          .where(eq(environments.workspaceId, id))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))), storage(operation));
        const row = rows[0];

        return row === undefined ? Option.none() : Option.some(snapshot(row));
      });

    /** The one write: current row on, then the revision it became recorded from the same row. */
    const write = (
      operation: Operation,
      workspaceId: string,
      provider: string,
      config: Schema.Json,
      authorId: string | null,
      now: number,
    ) =>
      Effect.gen(function* () {
        const independent = yield* snapshotJson(config).pipe(
          Effect.mapError(() => fail(operation, "invalid-input")),
        );

        const input = yield* Schema.decodeEffect(Input)({
          workspaceId,
          provider,
          config: independent,
        }).pipe(Effect.mapError(() => fail(operation, "invalid-input")));

        const text = yield* Schema.encodeEffect(ConfigText)(input.config).pipe(
          Effect.mapError(() => fail(operation, "invalid-input")),
        );

        // One batch: the revision number comes from the row this write produced, never from the
        // caller or a later concurrent write. The table constraint rejects revision overflow.
        yield* store
          .batch([
            sql`INSERT INTO workspace_environments (workspaceId, provider, config, revision)
            VALUES (${input.workspaceId}, ${input.provider}, ${text}, 1)
            ON CONFLICT(workspaceId) DO UPDATE SET provider = excluded.provider, config = excluded.config,
            revision = workspace_environments.revision + 1`,
            sql`INSERT INTO workspace_environment_revisions (key, workspaceId, revision, provider, config, authorId, createdAt)
            SELECT json_array(workspaceId, revision), workspaceId, revision, provider, config, ${authorId}, ${now}
            FROM workspace_environments WHERE workspaceId = ${input.workspaceId}`,
          ])
          .pipe(storage(operation));

        const stored = yield* read(operation, input.workspaceId);

        if (Option.isNone(stored)) return yield* fail(operation, "storage");
        return stored.value;
      });

    const get = Effect.fn("Environments.get")((workspaceId: string) => read("get", workspaceId));
    const set = Effect.fn("Environments.set")(
      (workspaceId: string, provider: string, config: Schema.Json, now: number) =>
        write("set", workspaceId, provider, config, null, now),
    );
    const view = Effect.fn("Environments.view")(function* (workspaceId: string, userId: string) {
      yield* roleOf("view", workspaceId, userId);
      return yield* read("view", workspaceId);
    });
    const history = Effect.fn("Environments.history")(function* (
      workspaceId: string,
      userId: string,
    ) {
      yield* roleOf("history", workspaceId, userId);

      const rows = yield* store.db
        .select()
        .from(environmentRevisions)
        .where(eq(environmentRevisions.workspaceId, workspaceId))
        .orderBy(desc(environmentRevisions.revision))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(RevisionRow))),
          storage("history"),
        );

      return rows.map((row) =>
        snapshotRevision(
          EnvironmentRevision.make({
            revision: row.revision,
            provider: row.provider,
            config: row.config,
            authorId: row.authorId,
            createdAt: row.createdAt,
          }),
        ),
      );
    });
    const save = Effect.fn("Environments.save")(function* (
      workspaceId: string,
      actorId: string,
      provider: string,
      config: Schema.Json,
      now: number,
    ) {
      yield* requireAdmin("save", workspaceId, actorId);
      return yield* write("save", workspaceId, provider, config, actorId, now);
    });

    return Service.of({ get, set, view, history, save });
  }),
);
export const layer = layerNoDeps;
export * as Environments from "./environments";
