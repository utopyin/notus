import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Canonical users. The profile is a snapshot from the latest dashboard sign-in, for display only. */
export const users = sqliteTable("account_users", {
  id: text().primaryKey(),
  name: text(),
  email: text(),
  image: text(),
  updatedAt: integer(),
  /** The login GitHub knows the user by, once they signed in with it; task branches live under it. */
  githubLogin: text(),
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

/**
 * Better Auth's tables, in the shared database under our names and migrations. Better Auth reads
 * and writes them through its D1 adapter with these model names and never migrates them itself.
 * Dates are ISO strings, as its adapter stores them. `account_logins` maps `auth_users.id` to the
 * canonical user.
 */
export const authUsers = sqliteTable("auth_users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer().notNull(),
  image: text(),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
  slackTeamId: text(),
  githubLogin: text(),
});
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text().primaryKey(),
    expiresAt: text().notNull(),
    token: text().notNull().unique(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_sessions_user").on(table.userId)],
);
/** One row per provider sign-in, with the provider's tokens; the GitHub row is the box's git login. */
export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: text(),
    refreshTokenExpiresAt: text(),
    scope: text(),
    password: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (table) => [index("auth_accounts_user").on(table.userId)],
);
export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: text().notNull(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (table) => [index("auth_verifications_identifier").on(table.identifier)],
);
