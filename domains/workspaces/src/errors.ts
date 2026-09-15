import * as Schema from "effect/Schema";

/** Deliberately excludes input, rows, and underlying errors that may contain configuration. */
export class EnvironmentError extends Schema.TaggedError<EnvironmentError>()(
  "Workspaces.EnvironmentError",
  {
    operation: Schema.Literals(["get", "set"]),
    reason: Schema.Literals(["invalid-input", "storage", "invalid-record"]),
  },
) {}

export class AccessError extends Schema.TaggedError<AccessError>()("Workspaces.AccessError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
export class Denied extends Schema.TaggedError<Denied>()("Workspaces.Denied", {
  workspaceId: Schema.String,
  reason: Schema.String,
}) {}

/** Excludes rows and underlying causes: names and invite tokens never reach a log. */
export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  "Workspaces.WorkspaceError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "storage",
      "not-found",
      "forbidden",
      "conflict",
      "expired",
      "last-admin",
      "not-installed",
    ]),
  },
) {}
