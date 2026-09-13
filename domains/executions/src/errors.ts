import * as Schema from "effect/Schema";

export class Conflict extends Schema.TaggedError<Conflict>()("Execution.Conflict", {
  message: Schema.String,
}) {}
export class StaleAttempt extends Schema.TaggedError<StaleAttempt>()("Execution.StaleAttempt", {
  attemptId: Schema.String,
}) {}
export class StorageFailure extends Schema.TaggedError<StorageFailure>()(
  "Execution.StorageFailure",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}
/** Deliberately excludes causes and caller payloads, which may contain opaque secrets. */
export class ProvisioningFailure extends Schema.TaggedError<ProvisioningFailure>()(
  "Execution.ProvisioningFailure",
  {
    reason: Schema.Literals([
      "invalid-input",
      "storage",
      "not-found",
      "conflict",
      "stale-claim",
      "stale-binding",
      "enrollment-not-expected",
      "recovery-unverified",
      "stale-readiness",
    ]),
  },
) {}
export class DevboxFailure extends Schema.TaggedError<DevboxFailure>()("Execution.DevboxFailure", {
  reason: Schema.Literals([
    "disabled",
    "unsupported-provider",
    "identity",
    "unavailable",
    "unproven",
  ]),
}) {}
export type ExecutionError = Conflict | StaleAttempt | StorageFailure | Schema.SchemaError;
