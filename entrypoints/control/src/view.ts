import { Attempts } from "@notus/executions/attempts";
import { Commands } from "@notus/executions/commands";
import { Provisioning } from "@notus/executions/provisioning";
import type { CommandRow, Step } from "@notus/executions/rows";
import { Steps } from "@notus/executions/steps";
import { State } from "@notus/tasks/state";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import type {
  CommandView,
  StepItem,
  StepView,
  TaskDetail,
  TaskStatus,
  TaskSummary,
  TurnView,
} from "./dashboard/types";

const record = (value: Schema.Json | undefined): { readonly [key: string]: Schema.Json } | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: Schema.Json })
    : null;

const text = (value: Schema.Json | undefined) => (typeof value === "string" ? value : "");

const command = (row: CommandRow): CommandView => {
  const spec = row.spec;
  const result = row.result;

  const [subject, input] =
    spec.kind === "shell"
      ? [spec.cwd, spec.script]
      : spec.kind === "checkout"
        ? [
            `${spec.repository.owner}/${spec.repository.name}${spec.pullRequest === undefined ? "" : ` #${spec.pullRequest}`}`,
            null,
          ]
        : spec.kind === "push"
          ? [spec.branch, null]
          : spec.kind === "specialist"
            ? [spec.agent, spec.instructions]
            : spec.kind === "update"
              ? ["origin conversation", spec.text]
              : [spec.title, spec.body];

  return {
    id: row.id,
    kind: spec.kind,
    status: row.status,
    subject,
    input,
    output: result
      ? {
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          truncated: result.truncated,
          stdout: result.stdout,
          stderr: result.stderr,
          report: result.specialist?.report ?? null,
        }
      : null,
    link: result?.pullRequest
      ? { label: `#${result.pullRequest.number}`, url: result.pullRequest.url }
      : null,
    failure: row.failure,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    updatedAt: row.updatedAt,
  };
};

/** Persisted response parts, read loosely: the operator owns their schema, the page only shows them. */
const step = (row: Step, commands: ReadonlyArray<CommandRow>): StepView => {
  const parts = Array.isArray(row.parts) ? row.parts.map(record) : [];
  const results = new Map<string, { readonly [key: string]: Schema.Json }>();

  for (const part of parts) if (part?.type === "tool-result") results.set(text(part.id), part);
  const items: Array<StepItem> = [];
  let tokens: number | null = null;

  for (const part of parts) {
    if (part === null) continue;

    if (part.type === "text" && text(part.text) !== "")
      items.push({ kind: "text", text: text(part.text) });
    else if (part.type === "reasoning" && text(part.text) !== "")
      items.push({ kind: "reasoning", text: text(part.text) });
    else if (part.type === "tool-call") {
      const id = text(part.id);
      const settled = results.get(id);

      const found = commands.find(
        (candidate) => candidate.stepId === row.id && candidate.callId === id,
      );

      items.push({
        kind: "tool",
        id,
        name: text(part.name),
        params: part.params ?? null,
        state: settled === undefined ? "waiting" : settled.isFailure === true ? "failed" : "done",
        result: found ? null : (settled?.result ?? null),
        command: found ? command(found) : null,
      });
    } else if (part.type === "finish") {
      const total = record(record(part.usage)?.inputTokens)?.total;
      const output = record(record(part.usage)?.outputTokens)?.total;

      if (typeof total === "number" || typeof output === "number")
        tokens =
          (typeof total === "number" ? total : 0) + (typeof output === "number" ? output : 0);
    }
  }

  return {
    id: row.id,
    index: row.index,
    status: row.status,
    attempts: row.attempts,
    failure: row.failure,
    tokens,
    items,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const describe = (item: Extract<StepItem, { kind: "tool" }>) => {
  const subject = item.command?.subject;

  switch (item.name) {
    case "create_devbox":
      return "Starting the devbox";
    case "run_command":
      return "Running a command";
    case "checkout_repository":
      return subject ? `Checking out ${subject}` : "Checking out the repository";
    case "push_branch":
      return subject ? `Pushing ${subject}` : "Pushing the branch";
    case "create_pull_request":
      return "Opening the pull request";
    case "post_update":
      return "Posting an update";
    case "run_specialist":
      return subject ? `Specialist ${subject} is working` : "A specialist is working";
    default:
      return `Running ${item.name}`;
  }
};

/** Where the latest turn stands, from its last step; turns without steps follow their invocation. */
const statusOf = (
  closed: boolean,
  latest: TurnView | undefined,
  pending: boolean,
  delivering: boolean,
): { readonly status: TaskStatus; readonly activity: string | null } => {
  if (closed) return { status: "closed", activity: null };

  const last = latest?.steps.at(-1);

  if (last === undefined)
    return pending ? { status: "queued", activity: "Queued" } : { status: "idle", activity: null };

  switch (last.status) {
    case "pending":
      return {
        status: "working",
        activity: last.attempts > 0 ? `Retrying after ${last.failure ?? "a failure"}` : "Thinking",
      };
    case "running":
      return { status: "working", activity: "Thinking" };
    case "waiting": {
      const waiting = last.items.find(
        (item): item is Extract<StepItem, { kind: "tool" }> =>
          item.kind === "tool" && item.state === "waiting",
      );

      return { status: "waiting", activity: waiting ? describe(waiting) : "Waiting" };
    }
    case "failed":
      return { status: "failed", activity: last.failure };
    case "done":
      return delivering
        ? { status: "working", activity: "Replying" }
        : { status: "idle", activity: null };
  }
};

/** The list row: the detail without its timeline and attachments. */
export const summarize = (detail: TaskDetail): TaskSummary => ({
  id: detail.id,
  workspaceId: detail.workspaceId,
  initiatorId: detail.initiatorId,
  mode: detail.mode,
  status: detail.status,
  activity: detail.activity,
  request: detail.request,
  origin: detail.origin,
  repository: detail.repository,
  pullRequest: detail.pullRequest,
  turns: detail.turns,
  steps: detail.steps,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
  closedAt: detail.closedAt,
});

const make = Effect.gen(function* () {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const commands = yield* Commands.Service;
  const provisioning = yield* Provisioning.Service;

  /** The task as the dashboard shows it, or null for an object that holds no task. */
  const read = Effect.fn("View.read")(function* () {
    const snapshot = yield* state.snapshot;
    const task = snapshot.task;
    if (task === null) return null;

    const execution = yield* attempts.snapshot;
    const stepRows = yield* steps.snapshot;
    const commandRows = yield* commands.snapshot;
    const box = yield* provisioning.current;
    const repository = yield* provisioning.repository;
    const instructions = yield* provisioning.instructions;

    const deliveryOf = new Map(
      snapshot.deliveries.flatMap((row) => (row.responseId ? [[row.responseId, row.status]] : [])),
    );
    const invocationOf = new Map(execution.invocations.map((row) => [row.inputId, row]));

    const timeline = [...snapshot.inputs]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row): TurnView => {
        const invocation = invocationOf.get(row.id);

        return {
          inputId: row.id,
          platform: row.input.target.source.platform,
          author: row.input.actor.externalId,
          text: row.input.text,
          answered: row.obligation === "fulfilled",
          createdAt: row.createdAt,
          steps: invocation
            ? stepRows
                .filter((candidate) => candidate.invocationId === invocation.id)
                .sort((a, b) => a.index - b.index)
                .map((candidate) => step(candidate, commandRows))
            : [],
          responses: snapshot.responses
            .filter((response) => response.inputId === row.id)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((response) => ({
              id: response.id,
              text: response.text,
              final: response.final,
              delivery: deliveryOf.get(response.id) ?? null,
              createdAt: response.createdAt,
            })),
        };
      });
    // Inputs that only add context to a turn still in flight get no invocation of their own.
    const latest = timeline.findLast((turn) => invocationOf.has(turn.inputId));
    const latestInvocation = latest ? invocationOf.get(latest.inputId) : undefined;

    const { status, activity } = statusOf(
      task.closedAt !== null,
      latest,
      latestInvocation?.status === "pending",
      snapshot.deliveries.some(
        (row) => row.kind === "answer" && (row.status === "pending" || row.status === "sending"),
      ),
    );

    const pullRequest = commandRows.findLast((row) => row.result?.pullRequest)?.result?.pullRequest;
    const origin = snapshot.sources.find((source) => source.id === task.originSourceId);

    const times = [
      task.createdAt,
      ...snapshot.inputs.map((row) => row.createdAt),
      ...snapshot.responses.map((row) => row.createdAt),
      ...stepRows.map((row) => row.updatedAt),
      ...commandRows.map((row) => row.updatedAt),
    ];

    const detail: TaskDetail = {
      id: task.id,
      workspaceId: task.reservation.workspaceId,
      initiatorId: task.reservation.initiatorId,
      mode: task.mode,
      status,
      activity,
      request: timeline[0]?.text ?? "",
      origin: {
        platform: task.reservation.source.platform,
        scope: task.reservation.source.scope,
        conversation: task.reservation.source.conversation,
      },
      repository: repository ? `${repository.owner}/${repository.name}` : null,
      pullRequest: pullRequest ? { number: pullRequest.number, url: pullRequest.url } : null,
      turns: timeline.length,
      steps: stepRows.length,
      createdAt: task.createdAt,
      updatedAt: Math.max(...times),
      closedAt: task.closedAt,
      sources: snapshot.sources.map((row) => ({
        platform: row.attachment.source.platform,
        scope: row.attachment.source.scope,
        conversation: row.attachment.source.conversation,
        origin: row.id === origin?.id,
      })),
      devbox: box
        ? {
            provider: box.providerName,
            phase: box.phase,
            blockedReason: box.blockedReason,
            resourceId: box.resourceId,
            lastReadyAt: box.lastReadyAt,
          }
        : null,
      roles: instructions.roles.map((role) => ({ name: role.name, revision: role.revision })),
      timeline,
    };

    return detail;
  });

  return { read };
});

export class Service extends Context.Service<Service>()("@notus/control/View", { make }) {}

export const layer = Layer.effect(Service, Service.make);

export * as View from "./view";
