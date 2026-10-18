import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

/*
 * Every tool's failure schema is its outcome: control reports a failed call as the same shape with
 * its error and isFailure set, and replaying it into the next round decodes against this schema.
 */

/** What the operator learns after asking for the task's dev box. */
export const DevboxResult = Schema.Struct({
  phase: Schema.String,
  ready: Schema.Boolean,
  resourceId: Schema.NullOr(Schema.String),
  blockedReason: Schema.NullOr(Schema.String),
  message: Schema.String,
});
export interface DevboxResult extends Schema.Schema.Type<typeof DevboxResult> {}

export const CreateDevbox = Tool.make("create_devbox", {
  description:
    "Provision the dev box for this task and wait until it is ready. Use it only when the task needs a machine and none exists yet, or the existing one is blocked: then it replaces that box with a new one, and nothing on the old box carries over. Readiness alone is the result; use run_command afterwards to do work on it.",
  parameters: Schema.Struct({
    purpose: Schema.String.annotate({ description: "Why the task needs a dev box now." }),
  }),
  success: DevboxResult,
  failure: DevboxResult,
});

/** Bounded, truncated output of one shell command on the task's dev box. */
export const CommandOutcome = Schema.Struct({
  exitCode: Schema.NullOr(Schema.Int),
  stdout: Schema.String,
  stderr: Schema.String,
  durationMs: Schema.Int,
  timedOut: Schema.Boolean,
  truncated: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export interface CommandOutcome extends Schema.Schema.Type<typeof CommandOutcome> {}

export const RunCommand = Tool.make("run_command", {
  description:
    "Run one bash command on this task's dev box as the devbox user and return its exit code and truncated output. Requires an existing dev box; a sleeping box is woken first, which may take a minute. The box holds no credentials.",
  parameters: Schema.Struct({
    command: Schema.String.annotate({ description: "The bash command line to execute." }),
    cwd: Schema.optionalKey(
      Schema.String.annotate({
        description:
          "Working directory: /workspaces or a checkout under it. Defaults to /workspaces.",
      }),
    ),
    purpose: Schema.String.annotate({ description: "What this command is for." }),
  }),
  success: CommandOutcome,
  failure: CommandOutcome,
});

/** Where the task's repository landed on the box. */
export const CheckoutOutcome = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  defaultBranch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export interface CheckoutOutcome extends Schema.Schema.Type<typeof CheckoutOutcome> {}

export const CheckoutRepository = Tool.make("checkout_repository", {
  description:
    "Clone the task's repository onto the dev box under /workspaces and return the checkout path, the branch, the default branch and the HEAD commit. The checkout lands on the default branch, or on a pull request's head branch when pullRequest is given: that is how to continue work on an existing pull request, which push_branch to that same branch then updates. Read-only: nothing can be pushed. Requires an existing dev box. When the workspace covers several repositories, name the one to work in; the choice is final for this task. Calling it again switches the existing checkout to the requested branch.",
  parameters: Schema.Struct({
    purpose: Schema.String.annotate({ description: "Why the task needs the repository now." }),
    repository: Schema.optionalKey(
      Schema.String.annotate({
        description:
          "owner/name of the repository to work in; required only when several are covered.",
      }),
    ),
    pullRequest: Schema.optionalKey(
      Schema.Int.annotate({
        description:
          "Number of a pull request in this repository to continue: the checkout lands on its head branch.",
      }),
    ),
  }),
  success: CheckoutOutcome,
  failure: CheckoutOutcome,
});

/** Where the task's branch went. */
export const PushOutcome = Schema.Struct({
  branch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
  /** False when the push published a commit this branch already had: nothing changed. */
  newCommit: Schema.NullOr(Schema.Boolean),
  error: Schema.NullOr(Schema.String),
});
export interface PushOutcome extends Schema.Schema.Type<typeof PushOutcome> {}

const Slug = Schema.String.annotate({
  description:
    "Short branch slug, lowercase letters, digits and dashes; the branch becomes <initiator username>/<slug>.",
});

export const PushBranch = Tool.make("push_branch", {
  description:
    "Push the checkout's commits to the branch <initiator username>/<slug> on GitHub. It does not commit: a specialist commits when your instructions tell it to, or you commit through git in run_command; a checkout with uncommitted changes is refused. Only branches under the initiator's username can be pushed; the default branch never. Pushing to the branch of a checked-out pull request updates that pull request. newCommit is false when the branch already had this commit, meaning nothing changed. Nothing is merged.",
  parameters: Schema.Struct({ slug: Slug }),
  success: PushOutcome,
  failure: PushOutcome,
});

/** The opened pull request, or why none exists. */
export const PullRequestOutcome = Schema.Struct({
  number: Schema.NullOr(Schema.Int),
  url: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export interface PullRequestOutcome extends Schema.Schema.Type<typeof PullRequestOutcome> {}

export const CreatePullRequest = Tool.make("create_pull_request", {
  description:
    "Open a pull request from the pushed branch <initiator username>/<slug> into the repository's default branch. Humans review and merge; Notus cannot. A pull request exists only when this tool returns its number and URL.",
  parameters: Schema.Struct({
    slug: Slug,
    title: Schema.String.annotate({ description: "Pull request title." }),
    body: Schema.String.annotate({
      description:
        "Pull request description: what changed, why, how it was checked, and open decisions.",
    }),
  }),
  success: PullRequestOutcome,
  failure: PullRequestOutcome,
});

/** Where the update landed, or why it did not. */
export const UpdateOutcome = Schema.Struct({
  reference: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export interface UpdateOutcome extends Schema.Schema.Type<typeof UpdateOutcome> {}

export const PostUpdate = Tool.make("post_update", {
  description:
    "Post a message in the conversation where this task started (its Slack thread), right now, without ending the turn: a progress note during long work, or the answer itself when the person asked to be told there rather than where they wrote. Returns once it is posted. If this message is your whole answer, end the turn with no text afterwards; an empty final answer is not posted anywhere.",
  parameters: Schema.Struct({
    text: Schema.String.annotate({ description: "The message, plain text suitable for Slack." }),
  }),
  success: UpdateOutcome,
  failure: UpdateOutcome,
});

/** What a specialist reported, or why the round produced no report. */
export const SpecialistOutcome = Schema.Struct({
  report: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export interface SpecialistOutcome extends Schema.Schema.Type<typeof SpecialistOutcome> {}

export const RunSpecialist = Tool.make("run_specialist", {
  description:
    "Give one round of work to a Codex coding agent running on the dev box in the repository checkout, and wait for its written report. Use it for implementation, fixes and reviews that take more than a few commands. The same agent name keeps the same agent and its memory across rounds. The agent receives the workspace's text for the role you name, then your instructions for the round. The agent edits files but cannot push; publish its changes with push_branch after checking them. Requires a checkout.",
  parameters: Schema.Struct({
    agent: Schema.String.annotate({
      description:
        "Agent name, lowercase letters, digits, dashes or underscores, starting with a letter, such as implementer or reviewer. Usually the role's name.",
    }),
    role: Schema.optionalKey(
      Schema.String.annotate({
        description:
          "One of the workspace's specialist roles, whose text opens the agent's instructions. Omit only when the workspace defines no role that fits.",
      }),
    ),
    instructions: Schema.String.annotate({
      description:
        "Complete, self-contained instructions for this round: the goal, the relevant files, constraints and what to report. Do not repeat what the role already says.",
    }),
  }),
  success: SpecialistOutcome,
  failure: SpecialistOutcome,
});

export const toolkit = Toolkit.make(
  CreateDevbox,
  RunCommand,
  CheckoutRepository,
  PushBranch,
  CreatePullRequest,
  RunSpecialist,
  PostUpdate,
);
/**
 * The handlers here are unreachable by construction: every tool call comes back unresolved.
 */
const unreachable = () => Effect.die("tool calls are executed durably by control, never inline");

export const ready = toolkit.pipe(
  Effect.provide(
    toolkit.toLayer({
      create_devbox: unreachable,
      run_command: unreachable,
      checkout_repository: unreachable,
      push_branch: unreachable,
      create_pull_request: unreachable,
      run_specialist: unreachable,
      post_update: unreachable,
    }),
  ),
);
/** Persisted parts keep tool parameters encoded, matching unresolved tool calls. */
export const encoded = Toolkit.make(
  CreateDevbox.setParameters(Schema.toEncoded(CreateDevbox.parametersSchema)),
  RunCommand.setParameters(Schema.toEncoded(RunCommand.parametersSchema)),
  CheckoutRepository.setParameters(Schema.toEncoded(CheckoutRepository.parametersSchema)),
  PushBranch.setParameters(Schema.toEncoded(PushBranch.parametersSchema)),
  CreatePullRequest.setParameters(Schema.toEncoded(CreatePullRequest.parametersSchema)),
  RunSpecialist.setParameters(Schema.toEncoded(RunSpecialist.parametersSchema)),
  PostUpdate.setParameters(Schema.toEncoded(PostUpdate.parametersSchema)),
);
export const names = Object.keys(toolkit.tools);
