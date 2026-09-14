import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

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
    "Provision the dev box for this task and wait until it is ready. Use it only when the task needs a machine and none exists yet. Readiness alone is the result; use run_command afterwards to do work on it.",
  parameters: Schema.Struct({
    purpose: Schema.String.annotate({ description: "Why the task needs a dev box now." }),
  }),
  success: DevboxResult,
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
});

/** Where the task's repository landed on the box. */
export const CheckoutOutcome = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export interface CheckoutOutcome extends Schema.Schema.Type<typeof CheckoutOutcome> {}

export const CheckoutRepository = Tool.make("checkout_repository", {
  description:
    "Clone this task's repository, at its default branch, onto the dev box under /workspaces and return the checkout path and HEAD commit. Read-only: nothing can be pushed. Requires an existing dev box. Calling it again returns the existing checkout.",
  parameters: Schema.Struct({
    purpose: Schema.String.annotate({ description: "Why the task needs the repository now." }),
  }),
  success: CheckoutOutcome,
});

/** Where the task's branch went. */
export const PushOutcome = Schema.Struct({
  branch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export interface PushOutcome extends Schema.Schema.Type<typeof PushOutcome> {}
const Slug = Schema.String.annotate({
  description:
    "Short branch slug, lowercase letters, digits and dashes; the branch becomes <initiator username>/<slug>.",
});

export const PushBranch = Tool.make("push_branch", {
  description:
    "Commit every change in the repository checkout as Notus and push it to the branch <initiator username>/<slug> on GitHub. Only branches under the initiator's username can be pushed; the default branch never. Requires a checkout with changes. Nothing is merged.",
  parameters: Schema.Struct({
    slug: Slug,
    message: Schema.String.annotate({ description: "Commit message summarizing the change." }),
  }),
  success: PushOutcome,
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
});

export const toolkit = Toolkit.make(
  CreateDevbox,
  RunCommand,
  CheckoutRepository,
  PushBranch,
  CreatePullRequest,
);
/**
 * Tool calls are never executed inline. Control records them as durable waits and resolves them
 * from provider observations, so the handlers here are unreachable by construction.
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
);
export const names = Object.keys(toolkit.tools);
