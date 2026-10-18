import * as Schema from "effect/Schema";

export class StorageError extends Schema.TaggedError<StorageError>()("Db.StorageError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
