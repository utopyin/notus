import * as Client from "@effect/sql-sqlite-do/SqliteClient";
import * as Drizzle from "drizzle-orm/effect-sqlite-do";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export type Database = Drizzle.EffectSQLiteDoDatabase;
/** Query-only shape also implemented by a Drizzle transaction. */
export type Queries = Pick<Database, "select" | "insert" | "update" | "delete">;

export class Service extends Context.Service<Service, Database>()("@notus/cloudflare/Sqlite") {}

/** Bind an existing Alchemy Drizzle DurableObject database without creating another client. */
export const layer = (db: Database) => Layer.succeed(Service, db);

/** Native host alternative. Drizzle owns transactionSync; never use client.withTransaction here. */
export const nativeSqlite = (storage: Parameters<typeof Drizzle.makeWithDefaults>[0]["storage"]) =>
  Layer.effect(Service, Drizzle.makeWithDefaults({ storage })).pipe(
    Layer.provide(Client.layer({ storage })),
  );

export * as Sqlite from "./sqlite";
