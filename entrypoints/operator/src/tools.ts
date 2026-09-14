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
    "Run one bash command on this task's dev box as the devbox user in /workspaces and return its exit code and truncated output. The box has no repository checked out and no credentials. Requires an existing dev box; a sleeping box is woken first, which may take a minute.",
  parameters: Schema.Struct({
    command: Schema.String.annotate({ description: "The bash command line to execute." }),
    purpose: Schema.String.annotate({ description: "What this command is for." }),
  }),
  success: CommandOutcome,
});

export const toolkit = Toolkit.make(CreateDevbox, RunCommand);
/**
 * Tool calls are never executed inline. Control records them as durable waits and resolves them
 * from provider observations, so the handlers here are unreachable by construction.
 */
const unreachable = () => Effect.die("tool calls are executed durably by control, never inline");
export const ready = toolkit.pipe(
  Effect.provide(toolkit.toLayer({ create_devbox: unreachable, run_command: unreachable })),
);
/** Persisted parts keep tool parameters encoded, matching unresolved tool calls. */
export const encoded = Toolkit.make(
  CreateDevbox.setParameters(Schema.toEncoded(CreateDevbox.parametersSchema)),
  RunCommand.setParameters(Schema.toEncoded(RunCommand.parametersSchema)),
);
export const names = Object.keys(toolkit.tools);
