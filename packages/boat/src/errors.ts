import * as Schema from "effect/Schema";

export const Operation = Schema.Literals(["create", "get", "stop", "resume", "delete", "command"]);
export type Operation = typeof Operation.Type;

/**
 * A Boat call that did not succeed. `notSent` and `rejected` changed nothing; `unknown` may have,
 * so the caller reconciles before another mutation. `code` is Boat's stable error code, never its
 * message or body.
 */
export class BoatError extends Schema.TaggedError<BoatError>()("Boat.BoatError", {
  operation: Operation,
  reason: Schema.Literals(["invalidInput", "transport", "timeout", "http", "invalidResponse"]),
  outcome: Schema.Literals(["notSent", "rejected", "notFound", "unknown"]),
  status: Schema.optionalKey(Schema.Int),
  code: Schema.optionalKey(Schema.String),
}) {}
