import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { defineRelations } from "drizzle-orm";
/**
 * One Connection Durable Object stores one user's saved model logins, at most one per provider:
 * a ChatGPT subscription for the operator and for Codex on the dev box, a platform API key for the
 * operator alone. Tokens are sealed before they reach a row; public reads project ConnectionStatus.
 */
export const connections = sqliteTable("account_connections", {
  provider: text({ enum: ["openai-chatgpt", "openai-api"] }).primaryKey(),
  userId: text().notNull(),
  /** Subscription logins carry the account; API keys have none. */
  accountId: text().notNull(),
  /** Sealed: the access token, or the API key. */
  access: text().notNull(),
  /** Sealed; empty for API keys. */
  refresh: text().notNull(),
  /** Sealed OpenID token of a subscription login, kept so an agent login file can be written. */
  idToken: text(),
  expiresAt: integer().notNull(),
  /** Identifies the explicit link that supplied the material; never the material itself. */
  seedFingerprint: text().notNull(),
  provenance: text().notNull().default("dashboard"),
  linkedAt: integer().notNull(),
  rotatedAt: integer(),
  revokedAt: integer(),
});

/** A device-code sign-in the user started and has not finished; one at a time. */
export const deviceLogins = sqliteTable("account_device_logins", {
  singleton: integer().primaryKey().$type<1>(),
  userId: text().notNull(),
  deviceAuthId: text().notNull(),
  userCode: text().notNull(),
  interval: integer().notNull(),
  startedAt: integer().notNull(),
});

/** Idempotent replay of a forwarded provider request, keyed by the caller's operation. */
export const forwards = sqliteTable("account_forwards", {
  operationId: text().primaryKey(),
  status: integer().notNull(),
  contentType: text(),
  body: text().notNull(),
  createdAt: integer().notNull(),
});

export const relations = defineRelations({ connections, deviceLogins, forwards });
