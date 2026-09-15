import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** One default environment per workspace. Config is JSON text, not a provider model. */
export const environments = sqliteTable(
  "workspace_environments",
  {
    workspaceId: text().primaryKey().notNull(),
    provider: text().notNull(),
    config: text().notNull(),
    revision: integer().notNull().default(1),
  },
  (table) => [
    check("workspace_environments_workspace", sql`length(${table.workspaceId}) > 0`),
    check("workspace_environments_provider", sql`length(${table.provider}) > 0`),
    check("workspace_environments_config", sql`json_valid(${table.config})`),
    check(
      "workspace_environments_revision",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);

/**
 * A platform installed for a workspace: a Slack team, a GitHub App installation. An installation
 * belongs to one workspace, so its events route to exactly one place.
 */
export const installations = sqliteTable(
  "workspace_installations",
  {
    /** key(platform, installationId) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    platform: text().notNull(),
    installationId: text().notNull(),
    label: text().notNull().default(""),
    installedBy: text().notNull(),
    installedAt: integer().notNull(),
  },
  (table) => [index("workspace_installations_workspace").on(table.workspaceId)],
);

/** A scope the workspace listens in or works on: a channel of an installed team, a repository of an installed App. */
export const sources = sqliteTable(
  "workspace_sources",
  {
    /** key(workspaceId, platform, installationId, scope) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    platform: text().notNull(),
    installationId: text().notNull(),
    scope: text().notNull(),
    label: text().notNull().default(""),
  },
  (table) => [index("workspace_sources_workspace").on(table.workspaceId)],
);

/** A team's configuration and access boundary. The fixture workspace is seeded with its ID as name. */
export const workspaces = sqliteTable("workspaces", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  createdBy: text().notNull(),
  createdAt: integer().notNull(),
});

export const memberships = sqliteTable(
  "workspace_memberships",
  {
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    userId: text().notNull(),
    role: text({ enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    provenance: text().notNull().default("admin-fixture"),
  },
  (table) => [uniqueIndex("workspace_memberships_user").on(table.workspaceId, table.userId)],
);

/** An invite link. Only the token's hash is stored; the token itself is shown once to the admin. */
export const invites = sqliteTable(
  "workspace_invites",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    tokenHash: text().notNull(),
    role: text({ enum: ["admin", "member"] }).notNull(),
    invitedBy: text().notNull(),
    createdAt: integer().notNull(),
    expiresAt: integer().notNull(),
    acceptedBy: text(),
    acceptedAt: integer(),
    revokedAt: integer(),
  },
  (table) => [uniqueIndex("workspace_invites_token").on(table.tokenHash)],
);
