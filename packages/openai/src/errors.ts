import * as Schema from "effect/Schema";

/** Provider failures never carry bodies, headers or bearer material. */
export class OAuthError extends Schema.TaggedError<OAuthError>()("OpenAi.OAuthError", {
  operation: Schema.Literals(["refresh", "exchange", "device"]),
  reason: Schema.Literals(["transport", "rejected", "invalid-response", "reconnect-required"]),
  status: Schema.optionalKey(Schema.Int),
}) {}

export class ForwardError extends Schema.TaggedError<ForwardError>()("OpenAi.ForwardError", {
  reason: Schema.Literals(["unsupported-request", "transport", "timeout", "invalid-response"]),
}) {}
