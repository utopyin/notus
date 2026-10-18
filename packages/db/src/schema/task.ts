import { defineRelations, sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * One Task Durable Object's SQLite database: the task record and its execution. JSON columns are
 * storage shapes; the tasks and executions domains decode them.
 */

const modes = ["simulation", "readiness", "operator"] as const;

// ─── Task ───

export const tasks = sqliteTable(
  "tasks",
  {
    // A DO can hold only one task. The task ID remains independently unique.
    singleton: integer().primaryKey().$type<1>(),
    id: text().notNull().unique(),
    reservation: text({ mode: "json" }).notNull(),
    mode: text({ enum: modes }).notNull(),
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
  attachment: text({ mode: "json" }).notNull(),
});
export const inputs = sqliteTable("task_inputs", {
  id: text().primaryKey(),
  messageKey: text().notNull().unique(),
  sourceId: text()
    .notNull()
    .references(() => sources.id),
  input: text({ mode: "json" }).notNull(),
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
    outcome: text({ mode: "json" }),
  },
  (t) => [
    index("task_delivery_due").on(t.status, t.retryAt),
    index("task_delivery_recovery").on(t.status, t.recoverAt),
    index("task_delivery_input").on(t.inputId),
  ],
);

// ─── Execution ───

export const attempts = sqliteTable(
  "execution_attempts",
  {
    id: text().primaryKey(),
    taskId: text().notNull(),
    generation: integer().notNull(),
    mode: text({ enum: modes }).notNull(),
    active: integer({ mode: "boolean" }).notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("execution_active_task")
      .on(t.taskId)
      .where(sql`${t.active} = 1`),
    uniqueIndex("execution_task_generation").on(t.taskId, t.generation),
  ],
);

export const invocations = sqliteTable(
  "execution_invocations",
  {
    id: text().primaryKey(),
    attemptId: text()
      .notNull()
      .references(() => attempts.id),
    generation: integer().notNull(),
    inputId: text().notNull().unique(),
    operationId: text().notNull().unique(),
    dueAt: integer().notNull(),
    version: integer().notNull(),
    resultId: text().notNull().unique(),
    content: text().notNull(),
    digest: text().notNull(),
    status: text({ enum: ["pending", "accepted"] }).notNull(),
  },
  (t) => [index("execution_invocation_due").on(t.status, t.dueAt)],
);

export const outcomes = sqliteTable("execution_outcomes", {
  id: text().primaryKey(),
  invocationId: text()
    .notNull()
    .unique()
    .references(() => invocations.id),
  observation: text({ mode: "json" }).notNull(),
  acceptedAt: integer().notNull(),
});

export const provisioning = sqliteTable("execution_provisioning", {
  attemptId: text()
    .primaryKey()
    .references(() => attempts.id),
  operationId: text().notNull().unique(),
  providerName: text().notNull().unique(),
  capabilityId: text().notNull().unique(),
  state: text({ mode: "json" }).notNull(),
});
export const enrollments = sqliteTable(
  "execution_enrollments",
  {
    attemptId: text()
      .notNull()
      .references(() => attempts.id),
    revision: integer().notNull(),
    requestId: text().notNull(),
    request: text({ mode: "json" }).notNull(),
    grant: text({ mode: "json" }).notNull(),
    acceptedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("execution_enrollment_revision").on(t.attemptId, t.revision),
    uniqueIndex("execution_enrollment_request").on(t.attemptId, t.requestId),
  ],
);
export const readiness = sqliteTable(
  "execution_readiness",
  {
    attemptId: text()
      .notNull()
      .references(() => attempts.id),
    epoch: integer().notNull(),
    observationId: text().notNull(),
    receipt: text({ mode: "json" }).notNull(),
  },
  (t) => [
    uniqueIndex("execution_readiness_epoch").on(t.attemptId, t.epoch),
    uniqueIndex("execution_readiness_observation").on(t.attemptId, t.observationId),
  ],
);
export const wakes = sqliteTable("execution_wakes", {
  inputId: text().primaryKey(),
  attemptId: text()
    .notNull()
    .references(() => attempts.id),
  receipt: text({ mode: "json" }).notNull(),
});

/**
 * Operator checkpoints: one model round per step, sequential within an invocation.
 * parts holds the encoded response once the step is done; the prompt is rebuilt from
 * the task record plus these parts, never from a live process.
 */
export const steps = sqliteTable(
  "execution_steps",
  {
    id: text().primaryKey(),
    invocationId: text()
      .notNull()
      .references(() => invocations.id),
    index: integer().notNull(),
    operationId: text().notNull().unique(),
    status: text({ enum: ["pending", "running", "waiting", "done", "failed"] }).notNull(),
    attempts: integer().notNull().default(0),
    dueAt: integer().notNull(),
    recoverAt: integer(),
    parts: text({ mode: "json" }),
    text: text(),
    /** Unresolved tool calls while status is waiting. */
    calls: text({ mode: "json" }),
    final: integer({ mode: "boolean" }).notNull().default(false),
    failure: text(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("execution_step_index").on(t.invocationId, t.index),
    index("execution_step_due").on(t.status, t.dueAt),
  ],
);

/** Durable commands for the assigned runtime, pulled by the supervisor and answered by observation. */
export const commands = sqliteTable(
  "execution_commands",
  {
    id: text().primaryKey(),
    attemptId: text()
      .notNull()
      .references(() => attempts.id),
    generation: integer().notNull(),
    stepId: text()
      .notNull()
      .references(() => steps.id),
    callId: text().notNull(),
    spec: text({ mode: "json" }).notNull(),
    executor: text({ enum: ["runtime", "control"] })
      .notNull()
      .default("runtime"),
    status: text({ enum: ["pending", "claimed", "done", "failed"] }).notNull(),
    claimEpoch: integer(),
    claimedAt: integer(),
    result: text({ mode: "json" }),
    failure: text(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("execution_command_call").on(t.stepId, t.callId),
    index("execution_command_status").on(t.status, t.createdAt),
  ],
);
/** Last runtime poll, so control knows whether the box is listening before asking for a wake. */
export const polls = sqliteTable("execution_polls", {
  singleton: integer().primaryKey().$type<1>(),
  epoch: integer().notNull(),
  polledAt: integer().notNull(),
});

/**
 * The repositories the workspace covered when the task was admitted, and the one the task works
 * in once chosen: the only candidate, or the operator's pick at checkout.
 */
export const repositories = sqliteTable("execution_repository", {
  singleton: integer().primaryKey().$type<1>(),
  candidates: text({ mode: "json" }).notNull(),
  repository: text({ mode: "json" }),
  capturedAt: integer().notNull(),
});

/** The workspace environment captured for this task before any provisioning decision. */
export const environments = sqliteTable("execution_environment", {
  singleton: integer().primaryKey().$type<1>(),
  environment: text({ mode: "json" }).notNull(),
  capturedAt: integer().notNull(),
});

/** The workspace's instructions captured for this task when it started; later edits never reach it. */
export const instructions = sqliteTable("execution_instructions", {
  singleton: integer().primaryKey().$type<1>(),
  instructions: text({ mode: "json" }).notNull(),
  capturedAt: integer().notNull(),
});

export const relations = defineRelations(
  {
    tasks,
    sources,
    inputs,
    events,
    responses,
    deliveries,
    attempts,
    invocations,
    outcomes,
    provisioning,
    enrollments,
    readiness,
    wakes,
    steps,
    commands,
    polls,
    repositories,
    environments,
    instructions,
  },
  (r) => ({
    tasks: {
      sources: r.many.sources(),
    },
    sources: {
      task: r.one.tasks({ from: r.sources.taskId, to: r.tasks.id }),
      inputs: r.many.inputs(),
    },
    inputs: {
      source: r.one.sources({ from: r.inputs.sourceId, to: r.sources.id }),
      events: r.many.events(),
      responses: r.many.responses(),
      deliveries: r.many.deliveries(),
    },
    events: {
      input: r.one.inputs({ from: r.events.inputId, to: r.inputs.id }),
    },
    responses: {
      input: r.one.inputs({ from: r.responses.inputId, to: r.inputs.id }),
      delivery: r.one.deliveries({ from: r.responses.id, to: r.deliveries.responseId }),
    },
    deliveries: {
      input: r.one.inputs({ from: r.deliveries.inputId, to: r.inputs.id }),
      response: r.one.responses({ from: r.deliveries.responseId, to: r.responses.id }),
    },
    attempts: {
      invocations: r.many.invocations(),
      provisioning: r.one.provisioning({ from: r.attempts.id, to: r.provisioning.attemptId }),
      enrollments: r.many.enrollments(),
      readiness: r.many.readiness(),
      wakes: r.many.wakes(),
      commands: r.many.commands(),
    },
    invocations: {
      attempt: r.one.attempts({ from: r.invocations.attemptId, to: r.attempts.id }),
      outcome: r.one.outcomes({ from: r.invocations.id, to: r.outcomes.invocationId }),
      steps: r.many.steps(),
    },
    outcomes: {
      invocation: r.one.invocations({ from: r.outcomes.invocationId, to: r.invocations.id }),
    },
    provisioning: {
      attempt: r.one.attempts({ from: r.provisioning.attemptId, to: r.attempts.id }),
    },
    enrollments: {
      attempt: r.one.attempts({ from: r.enrollments.attemptId, to: r.attempts.id }),
    },
    readiness: {
      attempt: r.one.attempts({ from: r.readiness.attemptId, to: r.attempts.id }),
    },
    wakes: {
      attempt: r.one.attempts({ from: r.wakes.attemptId, to: r.attempts.id }),
    },
    steps: {
      invocation: r.one.invocations({ from: r.steps.invocationId, to: r.invocations.id }),
      commands: r.many.commands(),
    },
    commands: {
      attempt: r.one.attempts({ from: r.commands.attemptId, to: r.attempts.id }),
      step: r.one.steps({ from: r.commands.stepId, to: r.steps.id }),
    },
  }),
);
