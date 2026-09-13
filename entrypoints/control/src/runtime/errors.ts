import * as Schema from "effect/Schema";

export class Failure extends Schema.TaggedError<Failure>()("Runtime.RequestFailure", {
  reason: Schema.Literals(["invalid", "unauthorized", "pending", "conflict", "unavailable"]),
}) {}
