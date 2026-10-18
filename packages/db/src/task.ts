import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import migrations from "../migrations/task/migrations";
import { relations } from "./schema/task";

export type Database = EffectSQLiteDoDatabase<typeof relations>;
/** Query-only shape, also implemented by a transaction. */
export type Queries = Pick<Database, "select" | "insert" | "update" | "delete">;

export class Service extends Context.Service<Service, Database>()("@notus/db/Task") {}

/** The current Task object's SQLite database, migrated on activation. Provide it in the instance Effect. */
export const layer = Layer.effect(Service, Drizzle.DurableObject({ migrations, relations }));

export * as TaskDb from "./task";
