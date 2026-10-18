import * as Schema from "effect/Schema";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { envelopes, messages, routes } from "./schema";

export const Receipt = Schema.Struct({
  eventKey: Schema.String,
  messageKey: Schema.String,
  inputId: Schema.String,
});
export interface Receipt extends Schema.Schema.Type<typeof Receipt> {}

export const DrainResult = Schema.Struct({
  scanned: Schema.Int,
  claimed: Schema.Int,
  forwarded: Schema.Int,
  retried: Schema.Int,
  context: Schema.Int,
  deferred: Schema.Int,
});
export interface DrainResult extends Schema.Schema.Type<typeof DrainResult> {}

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Timestamp = Schema.String.check(Schema.isPattern(/^\d+\.\d{6}$/));
export const MessageRow = createSelectSchema(messages, {
  startIntent: Schema.Literals([0, 1]),
  generation: Millis,
  attempts: Millis,
  receivedAt: Millis,
  recoverAt: Millis,
  dueAt: Millis,
  occurredAt: Timestamp,
});
export const RouteRow = createSelectSchema(routes, {
  initialized: Schema.Literals([0, 1]),
  createdAt: Millis,
  startAt: Timestamp,
});
export const EnvelopeRow = createSelectSchema(envelopes, { receivedAt: Millis });
export const Snapshot = Schema.Struct({
  messages: Schema.Array(MessageRow),
  routes: Schema.Array(RouteRow),
  envelopes: Schema.Array(EnvelopeRow),
});
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

/** A task the workspace's routes point at; its state is read from the task's own object. */
export const TaskRef = Schema.Struct({ taskId: Schema.NonEmptyString, createdAt: Millis });
export interface TaskRef extends Schema.Schema.Type<typeof TaskRef> {}

/** What the dashboard sees of a task: projections of its object's state, plain strings throughout. */
export type TaskStatus = "queued" | "working" | "waiting" | "idle" | "failed" | "closed";
export interface ConversationView {
  readonly platform: string;
  readonly scope: string;
  readonly conversation: string;
}
/** One durable command: what was asked, and what the box or control reported. */
export interface CommandView {
  readonly id: string;
  readonly kind: string;
  readonly status: "pending" | "claimed" | "done" | "failed";
  /** One line: the repository, branch, agent or pull request title. */
  readonly subject: string;
  /** The script, instructions or message the command carried. */
  readonly input: string | null;
  readonly output: {
    readonly exitCode: number | null;
    readonly durationMs: number;
    readonly timedOut: boolean;
    readonly truncated: boolean;
    readonly stdout: string;
    readonly stderr: string;
    /** The specialist's report, for rounds that wrote one. */
    readonly report: string | null;
  } | null;
  readonly link: { readonly label: string; readonly url: string } | null;
  readonly failure: string | null;
  readonly createdAt: number;
  readonly claimedAt: number | null;
  readonly updatedAt: number;
}
export type StepItem =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reasoning"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly name: string;
      readonly params: Schema.Json;
      readonly state: "waiting" | "done" | "failed";
      /** What the model was given back, when no command carries the result. */
      readonly result: Schema.Json;
      readonly command: CommandView | null;
    };
/** One model round of the operator. */
export interface StepView {
  readonly id: string;
  readonly index: number;
  readonly status: "pending" | "running" | "waiting" | "done" | "failed";
  readonly attempts: number;
  readonly failure: string | null;
  readonly tokens: number | null;
  readonly items: ReadonlyArray<StepItem>;
  readonly createdAt: number;
  readonly updatedAt: number;
}
export interface ResponseView {
  readonly id: string;
  readonly text: string;
  readonly final: boolean;
  readonly delivery: string | null;
  readonly createdAt: number;
}
/** One admitted input and everything the operator did for it. */
export interface TurnView {
  readonly inputId: string;
  readonly platform: string;
  readonly author: string;
  readonly text: string;
  readonly answered: boolean;
  readonly createdAt: number;
  readonly steps: ReadonlyArray<StepView>;
  readonly responses: ReadonlyArray<ResponseView>;
}
export interface TaskSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly initiatorId: string;
  readonly mode: string;
  readonly status: TaskStatus;
  /** What the task is doing right now, in a few words; null when idle. */
  readonly activity: string | null;
  /** The message that started the task. */
  readonly request: string;
  readonly origin: ConversationView;
  readonly repository: string | null;
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  readonly turns: number;
  readonly steps: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly closedAt: number | null;
}
export interface TaskDetail extends TaskSummary {
  readonly sources: ReadonlyArray<ConversationView & { readonly origin: boolean }>;
  readonly devbox: {
    readonly provider: string;
    readonly phase: string;
    readonly blockedReason: string | null;
    readonly resourceId: string | null;
    readonly lastReadyAt: number | null;
  } | null;
  /** The specialist roles captured when the task started, by revision. */
  readonly roles: ReadonlyArray<{ readonly name: string; readonly revision: number }>;
  readonly timeline: ReadonlyArray<TurnView>;
}
