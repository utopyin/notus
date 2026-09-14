import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
