import * as Schema from "effect/Schema";

export class ConfigError extends Schema.TaggedError<ConfigError>()("Namespace.ConfigError", {
  message: Schema.String,
}) {}

// Every failure means destruction is not proven. Never retain provider payloads or causes.
export class InstancesError extends Schema.TaggedError<InstancesError>()(
  "Namespace.InstancesError",
  {
    reason: Schema.Literals([
      "invalidInput",
      "transport",
      "timeout",
      "notFound",
      "rejected",
      "invalidResponse",
      "identityMismatch",
      "notDestroyed",
      "missingDestroyedAt",
      "invalidDestroyedAt",
    ]),
    status: Schema.optionalKey(Schema.Int),
  },
) {}

export class ControlError extends Schema.TaggedError<ControlError>()("Namespace.ControlError", {
  operation: Schema.Literals(["Create", "Fetch", "Activate", "Stop", "Expire"]),
  reason: Schema.Literals([
    "invalidInput",
    "transport",
    "timeout",
    "rejected",
    "invalidResponse",
    "identityMismatch",
  ]),
  // Unknown means reconcile before attempting another mutation. Interruption is not rollback either.
  outcome: Schema.Literals(["notSent", "unknown", "rejected"]),
  status: Schema.optionalKey(Schema.Int),
}) {}
