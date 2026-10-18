import * as Schema from "effect/Schema";

const Segment = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/));

/** One GitHub repository a task may target. The installation decides whether it is reachable. */
/** Owner and name only, for operations that never touch branches. */
export const RepositoryName = Schema.Struct({ owner: Segment, name: Segment });
export interface RepositoryName extends Schema.Schema.Type<typeof RepositoryName> {}
export const Repository = Schema.Struct({
  owner: Segment,
  name: Segment,
  defaultBranch: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._/-]{1,200}$/)),
  branchPrefix: Schema.optionalKey(Schema.String),
});
export interface Repository extends Schema.Schema.Type<typeof Repository> {}

/**
 * Any safe git branch name on the wire. Which branches a task may push to is control policy,
 * enforced where the command is built, so a policy change never strands a deployed runtime.
 */
export const TaskBranch = Schema.String.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
  Schema.makeFilter(
    (value) =>
      !value.includes("..") &&
      !value.includes("//") &&
      !value.includes("@{") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.endsWith(".lock"),
  ),
);
export const PullRequest = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\/[^\s]+$/)),
  branch: TaskBranch,
});
export interface PullRequest extends Schema.Schema.Type<typeof PullRequest> {}
export const InstallationToken = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.NonEmptyString),
  /** Epoch milliseconds. */
  expiresAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** What GitHub actually granted: non-secret, safe to log. */
  granted: Schema.Struct({
    permissions: Schema.Record(Schema.String, Schema.String),
    repositories: Schema.Array(Schema.String),
  }),
});
export interface InstallationToken extends Schema.Schema.Type<typeof InstallationToken> {}
