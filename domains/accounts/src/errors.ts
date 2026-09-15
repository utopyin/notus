import * as Schema from "effect/Schema";

export class IdentityError extends Schema.TaggedError<IdentityError>()("Accounts.IdentityError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
/** Deliberately excludes causes and payloads, which may contain bearer material. */
export class ConnectionError extends Schema.TaggedError<ConnectionError>()(
  "Accounts.ConnectionError",
  {
    reason: Schema.Literals([
      "invalid-input",
      "storage",
      "unauthorized",
      "not-linked",
      "revoked",
      "reconnect-required",
      "provider-unavailable",
      "provider-rejected",
      "conflict",
    ]),
  },
) {}
