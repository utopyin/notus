import * as Schema from "effect/Schema";

const Segment = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/));
/** One GitHub repository a task may target. The installation decides whether it is reachable. */
export const Repository = Schema.Struct({
  owner: Segment,
  name: Segment,
  defaultBranch: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._/-]{1,200}$/)),
});
export interface Repository extends Schema.Schema.Type<typeof Repository> {}

export const InstallationToken = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.NonEmptyString),
  /** Epoch milliseconds. */
  expiresAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export interface InstallationToken extends Schema.Schema.Type<typeof InstallationToken> {}
