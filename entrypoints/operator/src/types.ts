import * as Schema from "effect/Schema";

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
/** One thread message as the operator sees it. Provider markup is passed through. */
export const Message = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  /** Where a human message arrived: the Slack thread or the task's pull request. */
  via: Schema.Literals(["slack", "github"]),
  /** Source actor ID for human messages, null for Notus's own answers. */
  actor: Schema.NullOr(Schema.NonEmptyString),
  text: Schema.String,
  at: Millis,
});
export interface Message extends Schema.Schema.Type<typeof Message> {}

/** Everything the operator may know about the task before a model round. */
export const Briefing = Schema.Struct({
  taskId: Schema.NonEmptyString,
  initiatorId: Schema.NonEmptyString,
  devbox: Schema.NullOr(
    Schema.Struct({
      phase: Schema.NonEmptyString,
      resourceId: Schema.NullOr(Schema.NonEmptyString),
      lastReadyAt: Schema.NullOr(Millis),
    }),
  ),
  /** The repositories the workspace covers, as owner/name; the task works in one of them. */
  repositories: Schema.Array(Schema.NonEmptyString),
  /** The repository the task works in, once chosen; the default branch is known once checked out. */
  repository: Schema.NullOr(
    Schema.Struct({
      fullName: Schema.NonEmptyString,
      /** The branch the checkout is on; the default branch unless a pull request was checked out. */
      branch: Schema.NullOr(Schema.NonEmptyString),
      defaultBranch: Schema.NullOr(Schema.NonEmptyString),
      branchPrefix: Schema.NonEmptyString,
      checkoutPath: Schema.NullOr(Schema.NonEmptyString),
    }),
  ),
  /** The specialist roles the workspace defined, with the first line of each; a round names one. */
  roles: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, summary: Schema.String })),
  history: Schema.Array(Message),
  current: Message,
});
export interface Briefing extends Schema.Schema.Type<typeof Briefing> {}

/** An unresolved tool call the durable owner must execute and answer. */
export const ToolCall = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  params: Schema.Json,
});
export interface ToolCall extends Schema.Schema.Type<typeof ToolCall> {}

export const StepResult = Schema.Struct({
  /** Encoded response parts, replayable into the next prompt. */
  parts: Schema.Json,
  text: Schema.String,
  calls: Schema.Array(ToolCall),
  final: Schema.Boolean,
});
export interface StepResult extends Schema.Schema.Type<typeof StepResult> {}

/** How a failed model round should be treated by the durable owner. */
export const Disposition = Schema.TaggedUnion({
  Retry: { retryAt: Millis, failure: Schema.NonEmptyString },
  Failed: { failure: Schema.NonEmptyString },
});
export type Disposition = typeof Disposition.Type;
