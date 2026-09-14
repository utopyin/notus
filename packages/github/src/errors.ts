import * as Schema from "effect/Schema";

/** Never carries bodies, headers, keys or tokens. */
export class AppError extends Schema.TaggedError<AppError>()("GitHub.AppError", {
  operation: Schema.Literals(["jwt", "token", "pull-request", "permission", "comment", "reaction"]),
  reason: Schema.Literals(["configuration", "transport", "rejected", "invalid-response"]),
  status: Schema.optionalKey(Schema.Int),
  /** GitHub's short validation message, such as "not all refs are readable". Never a body dump. */
  detail: Schema.optionalKey(Schema.String),
}) {}
