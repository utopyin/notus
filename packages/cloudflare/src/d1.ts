import type { D1Database } from "@cloudflare/workers-types";
import * as Client from "@effect/sql-d1/D1Client";
import * as Drizzle from "drizzle-orm/effect-d1";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class StorageError extends Schema.TaggedError<StorageError>()("D1.StorageError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Host binding. Supply QueryDatabase.raw here, once per Worker execution scope. */
export class Binding extends Context.Service<Binding, D1Database>()(
  "@notus/cloudflare/d1/Binding",
) {}

export interface Interface {
  readonly db: Omit<Drizzle.EffectSQLiteD1Database, "transaction">;
  readonly batch: (queries: ReadonlyArray<SQL>) => Effect.Effect<void, StorageError>;
  readonly query: <A, I>(
    schema: Schema.Codec<A, I>,
    query: SQL,
  ) => Effect.Effect<ReadonlyArray<A>, StorageError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/cloudflare/d1/Service",
) {}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* Client.D1Client;
    const db = yield* Drizzle.makeWithDefaults({});
    const dialect = new SQLiteDialect();

    // Only this adapter constructs unsafe statements; Drizzle binds every SQL interpolation.
    const statement = (query: SQL) => {
      const compiled = dialect.sqlToQuery(query);
      return client.unsafe<Record<string, unknown>>(compiled.sql, compiled.params);
    };

    return Service.of({
      db,
      batch: Effect.fn("D1.batch")(function* (queries) {
        yield* client
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
);

const clientLayer = Layer.unwrap(
  Effect.gen(function* () {
    const db = yield* Binding;
    return Client.layer({ db });
  }),
);

export const layer = layerNoDeps.pipe(Layer.provide(clientLayer));
export * as D1 from "./d1";
