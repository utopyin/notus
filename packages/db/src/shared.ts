import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import type { EffectSQLiteD1Database } from "drizzle-orm/effect-d1";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { StorageError } from "./errors";
import { relations } from "./schema/shared";

/**
 * The shared D1 database. Deploy runs from the repository root, so paths are relative to it.
 * `Drizzle.Schema` writes a migration whenever the schema drifts from the latest snapshot, and
 * the database applies pending ones under Alchemy's `__alchemy_migrations`.
 */
export const Database = Effect.gen(function* () {
  const schema = yield* Drizzle.Schema("SharedSchema", {
    schema: "./packages/db/src/schema/shared.ts",
    out: "./packages/db/migrations/shared",
    dialect: "sqlite",
  });

  return yield* Cloudflare.D1.Database("SharedDatabase", {
    migrations: schema,
    readReplication: { mode: "disabled" },
  });
});

export interface Interface {
  /** D1 has no interactive transactions; group writes with `batch`. */
  readonly db: Omit<EffectSQLiteD1Database<typeof relations>, "transaction">;
  readonly batch: (queries: ReadonlyArray<SQL>) => Effect.Effect<void, StorageError>;
  readonly query: <A, I>(
    schema: Schema.Codec<A, I>,
    query: SQL,
  ) => Effect.Effect<ReadonlyArray<A>, StorageError>;
}

export class Service extends Context.Service<Service, Interface>()("@notus/db/Shared") {}

/**
 * Declares and binds the database. Provide it once per host: the D1 client opens on the first
 * query of each execution and closes with it.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const d1 = yield* Cloudflare.D1.QueryDatabase(yield* Database);
    const db = yield* Drizzle.D1(d1, { relations });
    const dialect = new SQLiteDialect();

    // Only this module constructs unsafe statements; Drizzle binds every SQL interpolation.
    const statement = (query: SQL) => {
      const compiled = dialect.sqlToQuery(query);
      return db.$client.unsafe<Record<string, unknown>>(compiled.sql, compiled.params);
    };

    return Service.of({
      db,
      batch: Effect.fn("SharedDb.batch")(function* (queries) {
        yield* db.$client
          .batch(queries.map(statement))
          .pipe(Effect.mapError((cause) => new StorageError({ operation: "batch", cause })));
      }),
      query: <A, I>(schema: Schema.Codec<A, I>, query: SQL) =>
        statement(query).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
          Effect.mapError((cause) => new StorageError({ operation: "query", cause })),
        ),
    });
  }),
).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));

export * as SharedDb from "./shared";
