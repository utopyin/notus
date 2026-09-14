import * as Schema from "effect/Schema";

/** Never carries bodies, headers, keys or tokens. */
export class AppError extends Schema.TaggedError<AppError>()("GitHub.AppError", {
  operation: Schema.Literals(["jwt", "token"]),
  reason: Schema.Literals(["configuration", "transport", "rejected", "invalid-response"]),
  status: Schema.optionalKey(Schema.Int),
}) {}
