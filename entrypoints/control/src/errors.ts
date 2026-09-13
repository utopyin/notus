import * as Schema from "effect/Schema";

export class IntakeError extends Schema.TaggedError<IntakeError>()("Control.IntakeError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Control.Conflict", {
  key: Schema.String,
}) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Control.Unauthorized", {
  workspaceId: Schema.String,
  reason: Schema.String,
}) {}
