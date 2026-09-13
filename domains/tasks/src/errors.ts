import * as Schema from "effect/Schema";

export class Conflict extends Schema.TaggedError<Conflict>()("Task.Conflict", {
  message: Schema.String,
}) {}
export class NotInitialized extends Schema.TaggedError<NotInitialized>()("Task.NotInitialized", {
  taskId: Schema.String,
}) {}
export class StaleClaim extends Schema.TaggedError<StaleClaim>()("Task.StaleClaim", {
  deliveryId: Schema.String,
}) {}
export class StorageFailure extends Schema.TaggedError<StorageFailure>()("Task.StorageFailure", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
export type TaskError =
  | Conflict
  | NotInitialized
  | StaleClaim
  | StorageFailure
  | Schema.SchemaError;
