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
    "Provision the dev box for this task and wait until it is ready. Use it only when the task needs a machine and none exists yet. It gives no repository, shell or command access in this increment; readiness alone is the result.",
  parameters: Schema.Struct({
    purpose: Schema.String.annotate({ description: "Why the task needs a dev box now." }),
  }),
  success: DevboxResult,
});

export const toolkit = Toolkit.make(CreateDevbox);
/**
 * Tool calls are never executed inline. Control records them as durable waits and resolves them
 * from provider observations, so the handler here is unreachable by construction.
 */
export const ready = toolkit.pipe(
  Effect.provide(
    toolkit.toLayer({
      create_devbox: () => Effect.die("tool calls are executed durably by control, never inline"),
    }),
  ),
);
/** Persisted parts keep tool parameters encoded, matching unresolved tool calls. */
export const encoded = Toolkit.make(
  CreateDevbox.setParameters(Schema.toEncoded(CreateDevbox.parametersSchema)),
);
export const names = Object.keys(toolkit.tools);
