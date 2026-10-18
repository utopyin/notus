import * as Schema from "effect/Schema";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { envelopes, messages, routes } from "@notus/db/schema/shared";

export const Receipt = Schema.Struct({
  eventKey: Schema.String,
  messageKey: Schema.String,
  inputId: Schema.String,
});
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}

export const DrainResult = Schema.Struct({
  scanned: Schema.Int,
  claimed: Schema.Int,
  forwarded: Schema.Int,
  retried: Schema.Int,
  context: Schema.Int,
  deferred: Schema.Int,
});
export interface DrainResult extends Schema.Schema.Type<typeof DrainResult> {}

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Timestamp = Schema.String.check(Schema.isPattern(/^\d+\.\d{6}$/));

export const MessageRow = createSelectSchema(messages, {
  startIntent: Schema.Literals([0, 1]),
  generation: Millis,
  attempts: Millis,
  receivedAt: Millis,
  recoverAt: Millis,
  dueAt: Millis,
  occurredAt: Timestamp,
});
export const RouteRow = createSelectSchema(routes, {
  initialized: Schema.Literals([0, 1]),
  createdAt: Millis,
  startAt: Timestamp,
});
export const EnvelopeRow = createSelectSchema(envelopes, { receivedAt: Millis });
export const Snapshot = Schema.Struct({
  messages: Schema.Array(MessageRow),
  routes: Schema.Array(RouteRow),
  envelopes: Schema.Array(EnvelopeRow),
});
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

/** A task the workspace's routes point at; its state is read from the task's own object. */
export const TaskRef = Schema.Struct({ taskId: Schema.NonEmptyString, createdAt: Millis });
export interface TaskRef extends Schema.Schema.Type<typeof TaskRef> {}
