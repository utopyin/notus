import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("account_users", {
  id: text().primaryKey(),
});

/** Administrator-provisioned fixture identities, not OAuth ownership evidence. */
export const identities = sqliteTable("account_identities", {
  key: text().primaryKey(),
  kind: text().notNull(),
  installationId: text().notNull(),
  externalId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => users.id),
  provenance: text().notNull().default("admin-fixture"),
});

/**
 * A dashboard sign-in (Better Auth user) mapped to the canonical Notus user it acts as. Usually
 * the same ID; an existing fixture user is adopted when the sign-in proves one of its identities.
 */
export const logins = sqliteTable("account_logins", {
  authUserId: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id),
  linkedAt: integer().notNull(),
});
