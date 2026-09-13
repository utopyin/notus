import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Schema from "effect/Schema";

/**
 * One Connection Durable Object stores exactly one user's saved model login.
 * Rows never leave the object; public reads project ConnectionStatus.
 */
export const connections = sqliteTable("account_connections", {
  singleton: integer().primaryKey().$type<1>(),
  userId: text().notNull(),
  provider: text({ enum: ["openai-chatgpt"] }).notNull(),
  accountId: text().notNull(),
  access: text().notNull(),
  refresh: text().notNull(),
  expiresAt: integer().notNull(),
  /** Identifies the explicit administrator link that supplied the original pair. */
  seedFingerprint: text().notNull(),
  provenance: text().notNull().default("admin-fixture"),
  linkedAt: integer().notNull(),
  rotatedAt: integer(),
  revokedAt: integer(),
});

/** Idempotent replay of a forwarded provider request, keyed by the caller's operation. */
export const forwards = sqliteTable("account_forwards", {
  operationId: text().primaryKey(),
  status: integer().notNull(),
  contentType: text(),
  body: text().notNull(),
  createdAt: integer().notNull(),
});

export const ConnectionRow = createSelectSchema(connections);
export interface ConnectionRow extends Schema.Schema.Type<typeof ConnectionRow> {}
export const ForwardRow = createSelectSchema(forwards);
export interface ForwardRow extends Schema.Schema.Type<typeof ForwardRow> {}

export const tables = { connections, forwards };
