import { Input, ReplyTarget, Reservation, Source } from "@notus/contracts/source";
import { Mode } from "@notus/executions/types";
import * as Schema from "effect/Schema";

export const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Settings = Schema.Struct({
  mode: Schema.optionalKey(Mode),
  simulationDelayMs: Millis,
  claimTtlMs: Schema.Int.check(Schema.isGreaterThan(0)),
});
export interface Settings extends Schema.Schema.Type<typeof Settings> {}

export const Handoff = Schema.Struct({
  taskId: Schema.NonEmptyString,
  inputId: Schema.NonEmptyString,
  createdAt: Millis,
});
export interface Handoff extends Schema.Schema.Type<typeof Handoff> {}

/** An accepted result handed to Tasks by Control. */
export const ResponseInput = Schema.Struct({
  id: Schema.NonEmptyString,
  inputId: Schema.NonEmptyString,
  content: Schema.String,
  digest: Schema.NonEmptyString,
  acceptedAt: Millis,
});
export interface ResponseInput extends Schema.Schema.Type<typeof ResponseInput> {}

export const Attachment = Schema.Struct({
  id: Schema.NonEmptyString,
  source: Source,
  origin: Schema.Literal(true),
  receive: Schema.Literal(true),
  reaction: Schema.Literal(true),
  reply: Schema.Literal(true),
  updates: Schema.Literal(true),
});
export interface Attachment extends Schema.Schema.Type<typeof Attachment> {}

export const DeliveryClaim = Schema.Struct({
  deliveryId: Schema.NonEmptyString,
  inputId: Input.fields.inputId,
  sourceId: Schema.NonEmptyString,
  target: ReplyTarget,
  kind: Schema.Literals(["reaction", "answer"]),
  text: Schema.NullOr(Schema.String),
  reaction: Schema.NullOr(Schema.Literal("eyes")),
  digest: Schema.NonEmptyString,
  claimId: Schema.NonEmptyString,
  generation: Schema.Int.check(Schema.isGreaterThan(0)),
  recoverAt: Millis,
});
export interface DeliveryClaim extends Schema.Schema.Type<typeof DeliveryClaim> {}

export const DeliveryOutcome = Schema.TaggedUnion({
  Confirmed: { receipt: Schema.NonEmptyString },
  RateLimited: { retryAt: Millis },
  Rejected: { code: Schema.NonEmptyString },
  Ambiguous: { code: Schema.NonEmptyString },
});
export type DeliveryOutcome = typeof DeliveryOutcome.Type;

export const AdmissionReceipt = Schema.Struct({
  taskId: Reservation.fields.taskId,
  inputId: Input.fields.inputId,
  duplicate: Schema.Boolean,
});
export interface AdmissionReceipt extends Schema.Schema.Type<typeof AdmissionReceipt> {}
