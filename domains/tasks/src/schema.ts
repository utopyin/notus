import { Input, Reservation } from "@notus/contracts/source";
import { Mode } from "@notus/executions/types";
import { sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as Schema from "effect/Schema";
import { Attachment, DeliveryOutcome } from "./types";

export const tasks = sqliteTable(
  "tasks",
  {
    // A DO can hold only one task. The task ID remains independently unique.
    singleton: integer().primaryKey().$type<1>(),
    id: text().notNull().unique(),
    reservation: text({ mode: "json" }).$type<Reservation>().notNull(),
    mode: text({ enum: Mode.literals }).notNull(),
    originSourceId: text().notNull(),
    createdAt: integer().notNull(),
    closedAt: integer(),
  },
  (t) => [check("tasks_singleton", sql`${t.singleton} = 1`)],
);
export const sources = sqliteTable("task_sources", {
  id: text().primaryKey(),
  taskId: text()
    .notNull()
    .references(() => tasks.id),
  attachment: text({ mode: "json" }).$type<Attachment>().notNull(),
});
export const inputs = sqliteTable("task_inputs", {
  id: text().primaryKey(),
  messageKey: text().notNull().unique(),
  sourceId: text()
    .notNull()
    .references(() => sources.id),
  input: text({ mode: "json" }).$type<Input>().notNull(),
  obligation: text({ enum: ["pending", "fulfilled"] }).notNull(),
  createdAt: integer().notNull(),
  fulfilledAt: integer(),
});
export const events = sqliteTable("task_events", {
  id: text().primaryKey(),
  inputId: text()
    .notNull()
    .references(() => inputs.id),
});
export const responses = sqliteTable("task_responses", {
  id: text().primaryKey(),
  inputId: text()
    .notNull()
    .references(() => inputs.id),
  resultId: text().notNull().unique(),
  text: text().notNull(),
  final: integer({ mode: "boolean" }).notNull(),
  createdAt: integer().notNull(),
});
export const deliveries = sqliteTable(
  "task_deliveries",
  {
    id: text().primaryKey(),
    inputId: text()
      .notNull()
      .references(() => inputs.id),
    responseId: text()
      .unique()
      .references(() => responses.id),
    kind: text({ enum: ["reaction", "answer"] }).notNull(),
    text: text(),
    digest: text().notNull(),
    status: text({
      enum: ["pending", "sending", "confirmed", "rejected", "ambiguous", "skipped"],
    }).notNull(),
    retryAt: integer().notNull(),
    claimId: text(),
    generation: integer().notNull().default(0),
    recoverAt: integer(),
    receipt: text(),
    failure: text(),
    outcome: text({ mode: "json" }).$type<DeliveryOutcome>(),
  },
  (t) => [
    index("task_delivery_due").on(t.status, t.retryAt),
    index("task_delivery_recovery").on(t.status, t.recoverAt),
    index("task_delivery_input").on(t.inputId),
  ],
);

export const TaskRow = createSelectSchema(tasks, { reservation: Reservation });
export const SourceRow = createSelectSchema(sources, { attachment: Attachment });
export const InputRow = createSelectSchema(inputs, { input: Input });
export const ResponseRow = createSelectSchema(responses);
export const DeliveryRow = createSelectSchema(deliveries, {
  outcome: Schema.NullOr(DeliveryOutcome),
});
export const EventRow = createSelectSchema(events);

export const tables = { tasks, sources, inputs, events, responses, deliveries };
