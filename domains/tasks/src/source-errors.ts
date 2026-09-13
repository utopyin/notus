import * as Schema from "effect/Schema";

export class SourceError extends Schema.TaggedError<SourceError>()("Tasks.SourceError", {
  classification: Schema.Literals(["unsupported", "rate-limited", "rejected", "ambiguous"]),
  retryAfter: Schema.optionalKey(Schema.Finite),
}) {}
