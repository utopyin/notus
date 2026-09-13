import * as Schema from "effect/Schema";

export class IdentityError extends Schema.TaggedError<IdentityError>()("Accounts.IdentityError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
export class FixtureConflict extends Schema.TaggedError<FixtureConflict>()(
  "Accounts.FixtureConflict",
  {
    identityKey: Schema.String,
  },
) {}
