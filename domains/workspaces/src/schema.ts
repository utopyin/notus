import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const channels = sqliteTable(
  "workspace_channels",
  {
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    teamId: text().notNull(),
    channelId: text().notNull(),
  },
  (table) => [
    uniqueIndex("workspace_channels_scope").on(table.workspaceId, table.teamId, table.channelId),
  ],
);

export const memberships = sqliteTable(
  "workspace_memberships",
  {
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    userId: text().notNull(),
    provenance: text().notNull().default("admin-fixture"),
  },
  (table) => [uniqueIndex("workspace_memberships_user").on(table.workspaceId, table.userId)],
);
