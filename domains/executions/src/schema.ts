import { Environment } from "@notus/workspaces/types";
import { sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import * as Schema from "effect/Schema";
import {
  BlockReason,
  Bootstrap,
  Claim,
  CommandResult,
  CommandSpec,
  RepositoryRef,
  Enrollment,
  EpochGrant,
  Millis,
  Mode,
  Observation,
  Phase,
  ReadinessReceipt,
  Resource,
  WakeReceipt,
  Work,
} from "./types";

export const attempts = sqliteTable(
  "execution_attempts",
  {
    id: text().primaryKey(),
    taskId: text().notNull(),
    generation: integer().notNull(),
    mode: text({ enum: Mode.literals }).notNull(),
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
  observation: text({ mode: "json" }).$type<Observation>().notNull(),
  acceptedAt: integer().notNull(),
});

export const Attempt = createSelectSchema(attempts);
export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}
export const Invocation = createSelectSchema(invocations);
export interface Invocation extends Schema.Schema.Type<typeof Invocation> {}
export const Outcome = createSelectSchema(outcomes, { observation: Observation });
export interface Outcome extends Schema.Schema.Type<typeof Outcome> {}

/** Private durable state. Public reads project ProvisioningStatus instead. */
export const ProvisioningState = Schema.Struct({
  bootstrap: Bootstrap,
  environment: Schema.NullOr(Environment),
  providerName: Schema.NonEmptyString,
  launchVersion: Schema.Literal(1),
  phase: Phase,
  blockedReason: Schema.NullOr(BlockReason),
  resource: Schema.NullOr(Resource),
  claimGeneration: Millis,
  claim: Schema.NullOr(Claim),
  nextWork: Schema.NullOr(Work),
  dueAt: Schema.NullOr(Millis),
  startupDeadline: Schema.NullOr(Millis),
  activationConfirmed: Schema.Boolean,
  /** An uncertain Activate must be reconciled, never issued again. */
  activationUncertain: Schema.Boolean,
  enrollmentExpected: Schema.Boolean,
  recoveryRevision: Millis,
  runtimeEpoch: Millis,
  startupEpoch: Schema.Int.check(Schema.isGreaterThan(0)),
  enrollment: Schema.NullOr(Enrollment),
  grant: Schema.NullOr(EpochGrant),
  ready: Schema.NullOr(ReadinessReceipt),
  updatedAt: Millis,
});
export interface ProvisioningState extends Schema.Schema.Type<typeof ProvisioningState> {}
export const provisioning = sqliteTable("execution_provisioning", {
  attemptId: text()
    .primaryKey()
    .references(() => attempts.id),
  operationId: text().notNull().unique(),
  providerName: text().notNull().unique(),
  capabilityId: text().notNull().unique(),
  state: text({ mode: "json" }).$type<ProvisioningState>().notNull(),
});
export const enrollments = sqliteTable(
  "execution_enrollments",
  {
    attemptId: text()
      .notNull()
      .references(() => attempts.id),
    revision: integer().notNull(),
    requestId: text().notNull(),
    request: text({ mode: "json" }).$type<Enrollment>().notNull(),
    grant: text({ mode: "json" }).$type<EpochGrant>().notNull(),
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
    receipt: text({ mode: "json" }).$type<ReadinessReceipt>().notNull(),
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
  receipt: text({ mode: "json" }).$type<WakeReceipt>().notNull(),
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
    parts: text({ mode: "json" }).$type<Schema.Json>(),
    text: text(),
    /** Unresolved tool calls while status is waiting. */
    calls: text({ mode: "json" }).$type<Schema.Json>(),
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
export const Step = createSelectSchema(steps, {
  parts: Schema.NullOr(Schema.Json),
  calls: Schema.NullOr(Schema.Json),
});
export interface Step extends Schema.Schema.Type<typeof Step> {}

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
    spec: text({ mode: "json" }).$type<CommandSpec>().notNull(),
    status: text({ enum: ["pending", "claimed", "done", "failed"] }).notNull(),
    claimEpoch: integer(),
    claimedAt: integer(),
    result: text({ mode: "json" }).$type<CommandResult>(),
    failure: text(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("execution_command_call").on(t.stepId, t.callId),
    index("execution_command_status").on(t.status, t.createdAt),
  ],
);
export const CommandRow = createSelectSchema(commands, {
  spec: CommandSpec,
  result: Schema.NullOr(CommandResult),
});
export interface CommandRow extends Schema.Schema.Type<typeof CommandRow> {}
/** Last runtime poll, so control knows whether the box is listening before asking for a wake. */
export const polls = sqliteTable("execution_polls", {
  singleton: integer().primaryKey().$type<1>(),
  epoch: integer().notNull(),
  polledAt: integer().notNull(),
});

/** The repository the task targets, captured once at admission from workspace configuration. */
export const repositories = sqliteTable("execution_repository", {
  singleton: integer().primaryKey().$type<1>(),
  repository: text({ mode: "json" }).$type<RepositoryRef>().notNull(),
  capturedAt: integer().notNull(),
});

/** The workspace environment captured for this task before any provisioning decision. */
export const environments = sqliteTable("execution_environment", {
  singleton: integer().primaryKey().$type<1>(),
  environment: text({ mode: "json" }).$type<Environment>().notNull(),
  capturedAt: integer().notNull(),
});

/** Drizzle migration aggregate. Parent owns migration generation. */
export const tables = {
  attempts,
  invocations,
  outcomes,
  provisioning,
  enrollments,
  readiness,
  wakes,
  steps,
  environments,
  commands,
  polls,
  repositories,
};
