import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
