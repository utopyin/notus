import { defineRelations, sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The shared D1 database: accounts, Better Auth, workspaces and the pre-task inbox. Rows store
 * storage shapes; each domain decodes JSON text and enforces its own rules.
 */

// ─── Accounts ───

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

// ─── Workspaces ───

/**
 * One default environment per workspace. Config is JSON text, not a provider model. The current
 * row lives here; every save also lands in the revision table, so a change can be traced and put
 * back.
 */
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

export const environmentRevisions = sqliteTable(
  "workspace_environment_revisions",
  {
    /** key(workspaceId, revision) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    revision: integer().notNull(),
    provider: text().notNull(),
    config: text().notNull(),
    /** Null when the deployment wrote it, not a person. */
    authorId: text(),
    createdAt: integer().notNull(),
  },
  (table) => [
    index("workspace_environment_revisions_workspace").on(table.workspaceId),
    check("workspace_environment_revisions_config", sql`json_valid(${table.config})`),
  ],
);

/**
 * What a workspace's boxes may start from on one provider: an image, a snapshot. The reference is
 * the provider's own string; this table never interprets it. At most one per provider is the
 * workspace's default.
 */
export const templates = sqliteTable(
  "workspace_templates",
  {
    /** key(workspaceId, provider, ref) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    provider: text().notNull(),
    ref: text().notNull(),
    label: text().notNull().default(""),
    isDefault: integer({ mode: "boolean" }).notNull().default(false),
    addedBy: text().notNull(),
    addedAt: integer().notNull(),
  },
  (table) => [
    index("workspace_templates_workspace").on(table.workspaceId),
    uniqueIndex("workspace_templates_default")
      .on(table.workspaceId, table.provider)
      .where(sql`${table.isDefault} = 1`),
    check("workspace_templates_provider", sql`length(${table.provider}) > 0`),
    check("workspace_templates_ref", sql`length(${table.ref}) BETWEEN 1 AND 1024`),
  ],
);

/**
 * The provider account a workspace connected for its boxes. The credential is the adapter's own
 * JSON, sealed; it is written by admins and read by the task host only, never projected.
 */
export const computeConnections = sqliteTable(
  "workspace_compute_connections",
  {
    /** key(workspaceId, provider) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    provider: text().notNull(),
    label: text().notNull().default(""),
    connectedBy: text().notNull(),
    connectedAt: integer().notNull(),
    credential: text().notNull(),
  },
  (table) => [
    index("workspace_compute_connections_workspace").on(table.workspaceId),
    check("workspace_compute_connections_provider", sql`length(${table.provider}) > 0`),
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
    /** The adapter's own JSON (a bot token, a bot user). Read by the API Worker only, never projected. */
    credential: text(),
  },
  (table) => [index("workspace_installations_workspace").on(table.workspaceId)],
);

/** An administrator sent to a platform to install it; single use, short-lived, keyed by the nonce the platform carries back. */
export const installIntents = sqliteTable("workspace_install_intents", {
  nonce: text().primaryKey(),
  workspaceId: text().notNull(),
  userId: text().notNull(),
  platform: text().notNull(),
  createdAt: integer().notNull(),
  expiresAt: integer().notNull(),
});

/** A scope the workspace listens in or works on: a channel of an installed team, a repository of an installed App. */
export const scopes = sqliteTable(
  "workspace_scopes",
  {
    /** key(workspaceId, platform, installationId, scope) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    platform: text().notNull(),
    installationId: text().notNull(),
    scope: text().notNull(),
    label: text().notNull().default(""),
  },
  (table) => [index("workspace_scopes_workspace").on(table.workspaceId)],
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

/**
 * A specialist role: Markdown a named agent follows (`implementer`, `reviewer`, ...). The current
 * text lives here; every save also lands in the revision table, so a task can name the revision
 * it captured.
 */
export const roles = sqliteTable(
  "workspace_roles",
  {
    /** key(workspaceId, name) */
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    name: text().notNull(),
    /** One line the operator reads when choosing which specialist to run. */
    summary: text().notNull().default(""),
    body: text().notNull(),
    revision: integer().notNull().default(1),
    authorId: text().notNull(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (table) => [index("workspace_roles_workspace").on(table.workspaceId)],
);

export const roleRevisions = sqliteTable(
  "workspace_role_revisions",
  {
    /** key(roleKey, revision) */
    key: text().primaryKey(),
    roleKey: text().notNull(),
    revision: integer().notNull(),
    summary: text().notNull().default(""),
    body: text().notNull(),
    authorId: text().notNull(),
    createdAt: integer().notNull(),
  },
  (table) => [index("workspace_role_revisions_role").on(table.roleKey)],
);

// ─── Inbox ───

export const envelopes = sqliteTable(
  "inbox_envelopes",
  {
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    messageKey: text().notNull(),
    payload: text().notNull(),
    receivedAt: integer().notNull(),
  },
  (table) => [index("inbox_envelopes_message").on(table.messageKey)],
);

export const messages = sqliteTable(
  "inbox_messages",
  {
    key: text().primaryKey(),
    workspaceId: text().notNull(),
    conversationKey: text().notNull(),
    inputId: text().notNull(),
    payload: text().notNull(),
    fingerprint: text().notNull(),
    occurredAt: text().notNull(),
    startIntent: integer().notNull().default(0),
    initiatorId: text(),
    receivedAt: integer().notNull(),
    state: text({ enum: ["pending", "sending", "done", "context"] })
      .notNull()
      .default("pending"),
    token: text(),
    generation: integer().notNull().default(0),
    recoverAt: integer().notNull().default(0),
    dueAt: integer().notNull(),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (table) => [
    index("inbox_messages_due").on(table.state, table.dueAt, table.receivedAt, table.key),
    index("inbox_messages_recovery").on(table.state, table.recoverAt),
    index("inbox_messages_conversation").on(table.conversationKey, table.state),
    uniqueIndex("inbox_messages_input").on(table.workspaceId, table.inputId),
  ],
);

export const routes = sqliteTable("inbox_routes", {
  key: text().primaryKey(),
  workspaceId: text().notNull(),
  // One task may own several conversations: its origin and any attached pull request.
  taskId: text().notNull(),
  initiatorId: text().notNull(),
  startMessageKey: text().notNull(),
  startInputId: text().notNull(),
  startAt: text().notNull(),
  source: text().notNull(),
  createdAt: integer().notNull(),
  initialized: integer().notNull().default(0),
});

export const relations = defineRelations(
  {
    users,
    identities,
    logins,
    authUsers,
    authSessions,
    authAccounts,
    authVerifications,
    environments,
    environmentRevisions,
    templates,
    computeConnections,
    installations,
    installIntents,
    scopes,
    workspaces,
    memberships,
    invites,
    roles,
    roleRevisions,
    envelopes,
    messages,
    routes,
  },
  (r) => ({
    users: {
      identities: r.many.identities(),
      logins: r.many.logins(),
      memberships: r.many.memberships(),
    },
    identities: {
      user: r.one.users({ from: r.identities.userId, to: r.users.id }),
    },
    logins: {
      user: r.one.users({ from: r.logins.userId, to: r.users.id }),
      authUser: r.one.authUsers({ from: r.logins.authUserId, to: r.authUsers.id }),
    },
    authUsers: {
      sessions: r.many.authSessions(),
      accounts: r.many.authAccounts(),
      logins: r.many.logins(),
    },
    authSessions: {
      user: r.one.authUsers({ from: r.authSessions.userId, to: r.authUsers.id }),
    },
    authAccounts: {
      user: r.one.authUsers({ from: r.authAccounts.userId, to: r.authUsers.id }),
    },
    workspaces: {
      memberships: r.many.memberships(),
      invites: r.many.invites(),
      installations: r.many.installations(),
      scopes: r.many.scopes(),
      templates: r.many.templates(),
      computeConnections: r.many.computeConnections(),
      roles: r.many.roles(),
      environment: r.one.environments({ from: r.workspaces.id, to: r.environments.workspaceId }),
      environmentRevisions: r.many.environmentRevisions(),
    },
    memberships: {
      workspace: r.one.workspaces({ from: r.memberships.workspaceId, to: r.workspaces.id }),
      user: r.one.users({ from: r.memberships.userId, to: r.users.id }),
    },
    invites: {
      workspace: r.one.workspaces({ from: r.invites.workspaceId, to: r.workspaces.id }),
    },
    installations: {
      workspace: r.one.workspaces({ from: r.installations.workspaceId, to: r.workspaces.id }),
    },
    scopes: {
      workspace: r.one.workspaces({ from: r.scopes.workspaceId, to: r.workspaces.id }),
    },
    templates: {
      workspace: r.one.workspaces({ from: r.templates.workspaceId, to: r.workspaces.id }),
    },
    computeConnections: {
      workspace: r.one.workspaces({
        from: r.computeConnections.workspaceId,
        to: r.workspaces.id,
      }),
    },
    environmentRevisions: {
      workspace: r.one.workspaces({
        from: r.environmentRevisions.workspaceId,
        to: r.workspaces.id,
      }),
    },
    roles: {
      workspace: r.one.workspaces({ from: r.roles.workspaceId, to: r.workspaces.id }),
      revisions: r.many.roleRevisions(),
    },
    roleRevisions: {
      role: r.one.roles({ from: r.roleRevisions.roleKey, to: r.roles.key }),
    },
  }),
);
