import * as Schema from "effect/Schema";

export class InvalidSignature extends Schema.TaggedError<InvalidSignature>()(
  "Slack.InvalidSignature",
  {},
) {}
export class InvalidEnvelope extends Schema.TaggedError<InvalidEnvelope>()(
  "Slack.InvalidEnvelope",
  {},
) {}

/** retryAfter is a delay in milliseconds, never a promise that retry is safe. */
export class DeliveryError extends Schema.TaggedError<DeliveryError>()("Slack.DeliveryError", {
  classification: Schema.Literals(["rate-limited", "rejected", "ambiguous"]),
  retryAfter: Schema.optionalKey(Schema.Finite),
}) {}
