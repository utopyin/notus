import { InstallationId, PlatformId } from "@notus/platform/ids";
import { conversationKeyOf, key, type Admission, type Source } from "@notus/platform/source";
import { Attempts } from "@notus/executions/attempts";
import { Commands } from "@notus/executions/commands";
import { Provisioning } from "@notus/executions/provisioning";
import { Steps, type StepClaim, type StepOutcome } from "@notus/executions/steps";
import {
  digest,
  WorkspacePath,
  type CommandResult,
  type CommandSpec,
  type ProvisioningStatus,
  type RepositoryRef,
} from "@notus/executions/types";
import { Operator } from "@notus/operator/operator";
import {
  CheckoutOutcome,
  CommandOutcome,
  DevboxResult,
  PullRequestOutcome,
  PushOutcome,
  SpecialistOutcome,
  UpdateOutcome,
} from "@notus/operator/tools";
import { Briefing, type Message } from "@notus/operator/types";
import { State } from "@notus/tasks/state";
import type { Environment, ResolvedInstructions } from "@notus/workspaces/types";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Inbox } from "./inbox";
import { acceptOutcome } from "./task";

const batchSize = 16;

/** Every admitted human input gets exactly one operator invocation and its first step. */
const schedule = Effect.fn("OperatorControl.schedule")(function* (now: number) {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const missing = yield* state.missingHandoffs(yield* attempts.scheduledInputIds, batchSize);

  for (const input of missing) {
    const attempt = yield* attempts.ensure(input.taskId, now, "operator");
    // Operator invocations carry no predetermined content; the accepted outcome does.
    const invocation = yield* attempts.schedule(attempt, input.inputId, now, "");
    yield* steps.ensure(invocation.id, now);
  }

  // A crash between scheduling and the first step must not strand the turn.
  const execution = yield* attempts.snapshot;

  for (const invocation of execution.invocations)
    if (invocation.status === "pending") yield* steps.ensure(invocation.id, now);

  return missing.length;
});

const fallback = (failure: string) =>
  `I could not answer this message because ${Operator.explain(failure)}. Nothing else was run.`;

/** Settled turns become accepted outcomes; every human input still receives a final answer. */
const settle = Effect.fn("OperatorControl.settle")(function* (now: number) {
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const state = yield* State.Service;
  const commands = yield* Commands.Service;
  const settled = yield* steps.settled(batchSize);
  const execution = yield* attempts.snapshot;
  const commandRows = yield* commands.snapshot;
  const outcomes = new Map(execution.outcomes.map((row) => [row.invocationId, row]));
  let count = 0;

  for (const entry of settled) {
    if (outcomes.has(entry.invocationId)) continue;

    const invocation = execution.invocations.find((row) => row.id === entry.invocationId);
    if (!invocation) continue;

    // A turn that already spoke through post_update may end with nothing: an empty answer is
    // recorded and not posted, so the person is not answered twice.
    const spoke = commandRows.some(
      (row) =>
        entry.stepIds.includes(row.stepId) &&
        row.spec.kind === "update" &&
        row.status === "done" &&
        row.result?.update !== undefined,
    );

    const content =
      entry.result._tag === "Final"
        ? entry.result.text.trim() || (spoke ? "" : "I have nothing to add to this message.")
        : fallback(entry.result.failure);

    yield* acceptOutcome(
      {
        operationId: invocation.operationId,
        attemptId: invocation.attemptId,
        generation: invocation.generation,
        invocationId: invocation.id,
        inputId: invocation.inputId,
        resultId: invocation.resultId,
        content,
        digest: digest(content),
      },
      now,
    );

    count++;
  }

  // Repair an accepted outcome whose response write was lost.
  const missing = new Set(
    yield* state.missingResponses(
      execution.outcomes.map((row) => row.id),
      batchSize,
    ),
  );

  for (const outcome of execution.outcomes)
    if (missing.has(outcome.id)) {
      yield* acceptOutcome(outcome.observation, now);
      count++;
    }

  return count;
});

/** Capture the workspace environment once, before the operator decides anything about a box. */
export const prepare = Effect.fn("OperatorControl.prepare")(function* (
  environment: Environment | null,
  repositories: ReadonlyArray<RepositoryRef>,
  instructions: ResolvedInstructions,
  now: number,
) {
  const provisioning = yield* Provisioning.Service;

  yield* provisioning.capture(environment, now);
  yield* provisioning.captureRepositories(repositories, now);
  yield* provisioning.captureInstructions(instructions, now);
});

const describe = (status: ProvisioningStatus): DevboxResult => {
  const ready = status.phase === "ready";

  return {
    phase: status.phase,
    ready,
    resourceId: status.resourceId,
    blockedReason: status.blockedReason,
    message: ready
      ? "The dev box is provisioned and its runtime reported ready. No repository, shell or command access exists yet."
      : `Provisioning stopped in phase ${status.phase}${status.blockedReason ? ` (${status.blockedReason})` : ""}. No dev box is usable.`,
  };
};

const encodeResult = Schema.encodeEffect(DevboxResult);
const encodeOutcome = Schema.encodeEffect(CommandOutcome);
const encodeCheckout = Schema.encodeEffect(CheckoutOutcome);

const RunParams = Schema.Struct({
  command: Schema.NonEmptyString.check(Schema.isMaxLength(8192)),
  cwd: Schema.optionalKey(WorkspacePath),
  purpose: Schema.String,
});
const CheckoutParams = Schema.Struct({
  purpose: Schema.String,
  repository: Schema.optionalKey(Schema.String),
  pullRequest: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
});

type Checkout = NonNullable<CommandResult["checkout"]>;

/** The checkout the box is on now: the last one that succeeded. */
const latestCheckout = (
  rows: ReadonlyArray<{
    readonly status: string;
    readonly result?: { readonly checkout?: Checkout } | null;
  }>,
) => {
  let found: Checkout | null = null;

  for (const row of rows) {
    if (row.status === "done" && row.result?.checkout) found = row.result.checkout;
  }

  return found;
};

const fullNameOf = (repository: RepositoryRef) => `${repository.owner}/${repository.name}`;
const checkoutPath = (repository: RepositoryRef) => `/workspaces/${repository.name}`;
const checkoutTimeoutMs = 300_000;
const encodePush = Schema.encodeEffect(PushOutcome);
const encodePull = Schema.encodeEffect(PullRequestOutcome);
const encodeSpecialist = Schema.encodeEffect(SpecialistOutcome);
const encodeUpdate = Schema.encodeEffect(UpdateOutcome);
const UpdateParams = Schema.Struct({ text: Schema.NonEmptyString.check(Schema.isMaxLength(4000)) });
/** A specialist round may run long; the box keeps an idle marker while it does. */
const specialistTimeoutMs = 45 * 60_000;
const specialistInstructionsMax = 32_000;

const SpecialistParams = Schema.Struct({
  agent: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/)),
  /** The provider sends optional keys as null; either spelling means "no role". */
  role: Schema.optionalKey(Schema.NullOr(Schema.String)),
  instructions: Schema.NonEmptyString.check(Schema.isMaxLength(specialistInstructionsMax)),
});

/**
 * What the specialist reads: the role's text as the workspace wrote it, then the operator's
 * instructions for the round, each a titled section so the agent can tell standing guidance from
 * today's goal. Without a role the operator's instructions go through unchanged.
 */
const composeSpecialist = (
  params: typeof SpecialistParams.Type,
  captured: ResolvedInstructions,
): { readonly instructions: string; readonly error?: undefined } | { readonly error: string } => {
  const wanted = params.role ?? null;
  if (wanted === null) return { instructions: params.instructions };

  const role = captured.roles.find((r) => r.name === wanted);

  if (!role)
    return {
      error:
        captured.roles.length === 0
          ? `the workspace defines no specialist roles, so role "${wanted}" does not exist; call again without a role`
          : `role "${wanted}" does not exist; the workspace's roles are ${captured.roles.map((r) => r.name).join(", ")}`,
    };

  const standing = [role.summary?.trim() ?? "", role.body.trim()].filter((t) => t !== "");
  const instructions = `# Role: ${role.name}\n\n${standing.join("\n\n")}\n\n# This round\n\n${params.instructions.trim()}`;

  return instructions.length > specialistInstructionsMax
    ? {
        error: `the role text and your instructions together exceed ${specialistInstructionsMax} characters; shorten the round's instructions`,
      }
    : { instructions };
};

const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,48}$/));
const PushParams = Schema.Struct({ slug: Slug });
const PullParams = Schema.Struct({
  slug: Slug,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  body: Schema.String.check(Schema.isMaxLength(60_000)),
});

const branchOf = (repository: RepositoryRef, slug: string) => `${repository.branchPrefix}/${slug}`;

/** Policy: exactly `<initiator login>/<slug>`, never the default branch. The wire schema is looser. */
const TaskBranchPolicy = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,48}$/),
);

const toolNames = new Set([
  "create_devbox",
  "run_command",
  "checkout_repository",
  "push_branch",
  "create_pull_request",
  "run_specialist",
  "post_update",
]);

// Operational bounds: one command's runtime, the grace before a silent runtime fails it, and
// how long a box may go without polling before a wake is requested on its behalf.
const commandTimeoutMs = 120_000;
const runtimeGraceMs = 10 * 60_000;
const pollStaleMs = 60_000;

const commandFailure = (error: string): CommandOutcome => ({
  exitCode: null,
  stdout: "",
  stderr: "",
  durationMs: 0,
  timedOut: false,
  truncated: false,
  error,
});

type Evaluation =
  | { readonly _tag: "Resolved"; readonly result: Schema.Json; readonly isFailure: boolean }
  | { readonly _tag: "Pending"; readonly deadline: number | null };

/** Read-only view of one unresolved call. resolveWaits applies the mutations it implies. */
const evaluate = Effect.fn("OperatorControl.evaluate")(function* (
  stepId: string,
  call: { readonly id: string; readonly name: string; readonly params: Schema.Json },
  now: number,
): Effect.fn.Return<Evaluation, never, Provisioning.Service | Commands.Service> {
  const provisioning = yield* Provisioning.Service;
  const commands = yield* Commands.Service;
  const status = yield* provisioning.current.pipe(Effect.orDie);

  if (call.name === "create_devbox") {
    if (
      status !== null &&
      status.pendingWork === null &&
      (status.phase === "ready" || status.phase === "blocked")
    ) {
      const encoded = yield* encodeResult(describe(status)).pipe(Effect.orDie);
      return { _tag: "Resolved", result: encoded, isFailure: status.phase !== "ready" };
    }

    return { _tag: "Pending", deadline: null };
  }

  if (!toolNames.has(call.name))
    return { _tag: "Resolved", result: { error: `unknown tool ${call.name}` }, isFailure: true };

  const name = call.name;

  const failed = (error: string): Effect.Effect<Evaluation> => {
    const encoded: Effect.Effect<Schema.Json, Schema.SchemaError> =
      name === "checkout_repository"
        ? encodeCheckout({ path: null, branch: null, defaultBranch: null, headSha: null, error })
        : name === "push_branch"
          ? encodePush({ branch: null, headSha: null, newCommit: null, error })
          : name === "create_pull_request"
            ? encodePull({ number: null, url: null, branch: null, error })
            : name === "run_specialist"
              ? encodeSpecialist({ report: null, error })
              : name === "post_update"
                ? encodeUpdate({ reference: null, error })
                : encodeOutcome(commandFailure(error));

    return encoded.pipe(
      Effect.orDie,
      Effect.map((result): Evaluation => ({ _tag: "Resolved", result, isFailure: true })),
    );
  };

  const onBox = name !== "create_pull_request";

  if (onBox && (status === null || status.resourceId === null))
    return yield* failed("no dev box exists for this task; create one first");

  if (onBox && status !== null && status.phase === "blocked")
    return yield* failed(`the dev box is blocked (${status.blockedReason ?? "unknown"})`);

  if (name !== "run_command" && (yield* provisioning.repository.pipe(Effect.orDie)) === null) {
    const candidates = yield* provisioning.candidates.pipe(Effect.orDie);

    return yield* failed(
      candidates.length === 0
        ? "the workspace covers no repository, so this task has none"
        : `no repository is chosen for this task yet; check out one of ${candidates.map(fullNameOf).join(", ")}`,
    );
  }

  if (name === "run_specialist") {
    const params = yield* Schema.decodeUnknownEffect(SpecialistParams)(call.params).pipe(
      Effect.option,
    );

    if (params._tag === "Some") {
      const composed = composeSpecialist(
        params.value,
        yield* provisioning.instructions.pipe(Effect.orDie),
      );

      if (composed.error !== undefined) return yield* failed(composed.error);
    }
  }

  const rows = yield* commands.ofStep(stepId).pipe(Effect.orDie);
  const command = rows.find((row) => row.callId === call.id);
  if (!command) return yield* failed("the command was rejected before it was queued");

  if (command.status === "done" && command.result) {
    const stderr = command.result.stderr ? `: ${command.result.stderr.slice(0, 500)}` : "";

    if (name === "checkout_repository") {
      const done = command.result.checkout;
      if (!done) return yield* failed(`checkout failed${stderr}`);

      const encoded = yield* encodeCheckout({
        path: done.path,
        branch: done.branch,
        defaultBranch: done.defaultBranch ?? done.branch,
        headSha: done.headSha,
        error: null,
      }).pipe(Effect.orDie);

      return { _tag: "Resolved", result: encoded, isFailure: false };
    }

    if (name === "push_branch") {
      const done = command.result.push;
      if (!done) return yield* failed(`push failed${stderr}`);

      // The runtime re-publishes an unchanged HEAD as success; an earlier push of the same commit means nothing changed.
      const repeated = (yield* commands.snapshot.pipe(Effect.orDie)).some(
        (row) =>
          row.id !== command.id &&
          row.spec.kind === "push" &&
          row.status === "done" &&
          row.result?.push?.branch === done.branch &&
          row.result.push.headSha === done.headSha,
      );

      const encoded = yield* encodePush({ ...done, newCommit: !repeated, error: null }).pipe(
        Effect.orDie,
      );

      return { _tag: "Resolved", result: encoded, isFailure: false };
    }

    if (name === "run_specialist") {
      const done = command.result.specialist;
      if (!done) return yield* failed(`the specialist round produced no report${stderr}`);

      const encoded = yield* encodeSpecialist({ report: done.report, error: null }).pipe(
        Effect.orDie,
      );

      return { _tag: "Resolved", result: encoded, isFailure: false };
    }

    if (name === "post_update") {
      const done = command.result.update;
      if (!done) return yield* failed(`the update was not posted${stderr}`);

      const encoded = yield* encodeUpdate({ reference: done.reference, error: null }).pipe(
        Effect.orDie,
      );

      return { _tag: "Resolved", result: encoded, isFailure: false };
    }

    if (name === "create_pull_request") {
      const done = command.result.pullRequest;
      if (!done) return yield* failed(`pull request failed${stderr}`);

      const encoded = yield* encodePull({ ...done, error: null }).pipe(Effect.orDie);

      return { _tag: "Resolved", result: encoded, isFailure: false };
    }

    const encoded = yield* encodeOutcome({
      exitCode: command.result.exitCode,
      stdout: command.result.stdout,
      stderr: command.result.stderr,
      durationMs: command.result.durationMs,
      timedOut: command.result.timedOut,
      truncated: command.result.truncated,
      error: null,
    }).pipe(Effect.orDie);

    return { _tag: "Resolved", result: encoded, isFailure: command.result.exitCode !== 0 };
  }

  if (command.status === "failed") return yield* failed(command.failure ?? "command failed");

  const deadline = command.createdAt + command.spec.timeoutMs + runtimeGraceMs;

  if (now >= deadline) return yield* failed("the dev box runtime did not report a result in time");
  return { _tag: "Pending", deadline };
});

/** Start durable work for unresolved tool calls. Idempotent: provisioning binds once per attempt. */
const dispatch = Effect.fn("OperatorControl.dispatch")(function* (now: number) {
  const steps = yield* Steps.Service;
  const provisioning = yield* Provisioning.Service;
  const state = yield* State.Service;
  const waiting = yield* steps.waiting(batchSize);

  if (waiting.length === 0) return;

  const task = (yield* state.snapshot).task;
  if (!task) return;

  const commands = yield* Commands.Service;

  for (const step of waiting)
    for (const call of step.calls) {
      if (call.name === "create_devbox") {
        if ((yield* provisioning.current) !== null) continue;

        const environment = yield* provisioning.captured;

        yield* provisioning.initialize(
          { taskId: task.id, workspaceId: task.reservation.workspaceId, environment },
          now,
        );

        continue;
      }

      if (!toolNames.has(call.name) || call.name === "create_devbox") continue;

      const status = yield* provisioning.current;

      const checkoutParams =
        call.name === "checkout_repository"
          ? yield* Schema.decodeUnknownEffect(CheckoutParams)(call.params).pipe(Effect.option)
          : ({ _tag: "None" } as const);

      // Checking out is where the task's repository is settled: the only candidate, or the named one.
      if (call.name === "checkout_repository" && (yield* provisioning.repository) === null) {
        const candidates = yield* provisioning.candidates;

        const wanted =
          checkoutParams._tag === "Some" && checkoutParams.value.repository !== undefined
            ? checkoutParams.value.repository
            : candidates.length === 1
              ? fullNameOf(candidates[0]!)
              : null;

        if (wanted !== null) yield* provisioning.selectRepository(wanted);
      }

      const repository = yield* provisioning.repository;
      // The default branch as the checkout reported it; older runtimes only reported where they landed.
      const checkedOut = latestCheckout(yield* commands.snapshot);
      const defaultBranch = checkedOut?.defaultBranch ?? checkedOut?.branch ?? null;

      if (
        call.name !== "create_pull_request" &&
        call.name !== "post_update" &&
        (status === null || status.resourceId === null || status.phase === "blocked")
      )
        continue;

      let spec: CommandSpec;

      if (call.name === "post_update") {
        const params = yield* Schema.decodeUnknownEffect(UpdateParams)(call.params).pipe(
          Effect.option,
        );

        if (params._tag === "None") continue;

        // The origin conversation's thread: where the task's first input arrived.
        const snapshot = yield* state.snapshot;
        const origin = snapshot.sources.find((row) => row.attachment.origin);
        const first = origin
          ? [...snapshot.inputs]
              .filter((row) => row.sourceId === origin.id)
              .sort((left, right) => left.createdAt - right.createdAt)[0]
          : undefined;
        if (!first) continue;

        spec = {
          kind: "update",
          target: first.input.target,
          text: params.value.text,
          timeoutMs: 60_000,
        };
      } else if (call.name === "checkout_repository") {
        if (repository === null) continue;

        const pullRequest =
          checkoutParams._tag === "Some" ? checkoutParams.value.pullRequest : undefined;

        spec = {
          kind: "checkout",
          repository,
          path: checkoutPath(repository),
          ...(pullRequest === undefined ? {} : { pullRequest }),
          timeoutMs: checkoutTimeoutMs,
        };
      } else if (call.name === "push_branch") {
        if (repository === null) continue;

        const params = yield* Schema.decodeUnknownEffect(PushParams)(call.params).pipe(
          Effect.option,
        );

        if (params._tag === "None") continue;

        const branch = yield* Schema.decodeEffect(TaskBranchPolicy)(
          branchOf(repository, params.value.slug),
        ).pipe(Effect.option);

        if (branch._tag === "None" || branch.value === defaultBranch) continue;

        spec = {
          kind: "push",
          repository,
          path: checkoutPath(repository),
          branch: branch.value,
          timeoutMs: checkoutTimeoutMs,
        };
      } else if (call.name === "create_pull_request") {
        if (repository === null) continue;

        const params = yield* Schema.decodeUnknownEffect(PullParams)(call.params).pipe(
          Effect.option,
        );

        if (params._tag === "None") continue;

        const branch = yield* Schema.decodeEffect(TaskBranchPolicy)(
          branchOf(repository, params.value.slug),
        ).pipe(Effect.option);

        // A pull request needs the checkout's default branch as its base.
        if (branch._tag === "None" || defaultBranch === null || branch.value === defaultBranch)
          continue;

        spec = {
          kind: "pull-request",
          repository,
          branch: branch.value,
          base: defaultBranch,
          title: params.value.title,
          body: params.value.body,
          timeoutMs: 60_000,
        };
      } else if (call.name === "run_specialist") {
        if (repository === null) continue;

        const params = yield* Schema.decodeUnknownEffect(SpecialistParams)(call.params).pipe(
          Effect.option,
        );

        if (params._tag === "None") continue;

        // A role the workspace never defined is answered by evaluate, not run without it.
        const composed = composeSpecialist(params.value, yield* provisioning.instructions);

        if (composed.error !== undefined) continue;

        spec = {
          kind: "specialist",
          agent: params.value.agent,
          instructions: composed.instructions,
          path: checkoutPath(repository),
          timeoutMs: specialistTimeoutMs,
        };
      } else {
        const params = yield* Schema.decodeUnknownEffect(RunParams)(call.params).pipe(
          Effect.option,
        );

        if (params._tag === "None") continue;

        spec = {
          kind: "shell",
          script: params.value.command,
          cwd: params.value.cwd ?? "/workspaces",
          timeoutMs: commandTimeoutMs,
        };
      }

      const row = yield* commands.enqueue(step.id, call.id, spec, now);

      if (row.status !== "pending" || row.executor !== "runtime") continue;

      // A box that has not polled recently may be asleep; the provider path handles the rest.
      const poll = yield* commands.lastPoll;

      if (poll === null || now - poll.polledAt > pollStaleMs)
        yield* provisioning.requestWake(row.id, now).pipe(Effect.ignore);
    }
});

/** Resolve waiting steps whose durable work has settled; unknown tools fail immediately. */
/**
 * A pull request conversation belongs to the task now working on it: opening one or checking one
 * out by number attaches it here and moves its inbox route from whichever task held it, so its
 * comments land where the current work and its box are. Earlier tasks keep their history.
 */
const followPullRequest = Effect.fn("OperatorControl.followPullRequest")(function* (
  stepId: string,
  callId: string,
  now: number,
) {
  const commands = yield* Commands.Service;
  const state = yield* State.Service;
  const inbox = yield* Inbox.Service;
  const row = (yield* commands.ofStep(stepId)).find((entry) => entry.callId === callId);

  if (!row || row.status !== "done") return;

  const source: Source | null =
    row.spec.kind === "checkout" && row.spec.pullRequest !== undefined && row.result?.checkout
      ? {
          platform: "github",
          installationId: InstallationId.make(row.spec.repository.installationId),
          scope: PlatformId.make(`${row.spec.repository.owner}/${row.spec.repository.name}`),
          conversation: PlatformId.make(String(row.spec.pullRequest)),
        }
      : row.spec.kind === "pull-request" && row.result?.pullRequest
        ? row.result.pullRequest.source
        : null;
  if (source === null) return;

  const task = (yield* state.snapshot).task;
  if (!task) return;

  yield* state.attach(source, now);

  yield* inbox.takeover({
    taskId: task.id,
    workspaceId: task.reservation.workspaceId,
    conversationKey: conversationKeyOf(task.reservation.workspaceId, source),
    initiatorId: task.reservation.initiatorId,
    startInputId: key("pull-request", source.scope, source.conversation),
    // Whole seconds: GitHub timestamps have second precision.
    startAt: `${Math.floor(now / 1000)}.000000`,
    source,
  });
});

const resolveWaits = Effect.fn("OperatorControl.resolveWaits")(function* (now: number) {
  const steps = yield* Steps.Service;
  const commands = yield* Commands.Service;
  let count = 0;

  for (const step of yield* steps.waiting(batchSize)) {
    const results: Array<Schema.Json> = [];
    let pending = false;

    for (const call of step.calls) {
      const evaluation = yield* evaluate(step.id, call, now);

      if (evaluation._tag === "Pending") {
        pending = true;
        continue;
      }

      if (
        (call.name === "checkout_repository" || call.name === "create_pull_request") &&
        !evaluation.isFailure
      )
        yield* followPullRequest(step.id, call.id, now).pipe(
          Effect.catchCause(() => Effect.logWarning("task.pull_request_follow_failed")),
        );

      if (call.name === "run_command" && evaluation.isFailure) {
        // A silent runtime is recorded as failed so a late observation cannot revive the call.
        const rows = yield* commands.ofStep(step.id);
        const command = rows.find((row) => row.callId === call.id);

        if (command && (command.status === "pending" || command.status === "claimed"))
          yield* commands.fail(command.id, "no runtime response", now);
      }

      results.push(Operator.toolResult(call, evaluation.result, evaluation.isFailure));
    }

    if (pending) continue;

    yield* steps.resolve(step.id, results, now);
    count++;
  }

  return count;
});

export const admit = Effect.fn("OperatorControl.admit")(function* (command: Admission) {
  const state = yield* State.Service;
  const receipt = yield* state.admit(command);

  yield* schedule(yield* Clock.currentTimeMillis);

  return receipt;
});

/** Local-only repair. Model calls happen outside the host gate through claim/record. */
export const advance = Effect.fn("OperatorControl.advance")(function* (now: number) {
  const scheduled = yield* schedule(now);

  yield* dispatch(now);
  const resolved = yield* resolveWaits(now);

  return scheduled + resolved + (yield* settle(now));
});

export interface Claimed {
  readonly step: StepClaim;
  readonly briefing: Briefing;
}

const brief = Effect.fn("OperatorControl.brief")(function* (invocationId: string) {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const provisioning = yield* Provisioning.Service;
  const snapshot = yield* state.snapshot;
  const execution = yield* attempts.snapshot;
  const invocation = execution.invocations.find((row) => row.id === invocationId);
  const task = snapshot.task;
  const current = snapshot.inputs.find((row) => row.id === invocation?.inputId);

  if (!task || !invocation || !current) return null;

  const inputs = new Map(snapshot.inputs.map((row) => [row.id, row]));
  const history: Array<Message> = [];

  for (const row of snapshot.inputs) {
    if (row.id === current.id || row.createdAt > current.createdAt) continue;

    history.push({
      role: "user",
      via: row.input.actor.platform,
      actor: row.input.actor.externalId,
      text: row.input.text,
      at: row.createdAt,
    });
  }

  for (const row of snapshot.responses) {
    const input = inputs.get(row.inputId);

    if (!row.final || !input || input.createdAt > current.createdAt || row.inputId === current.id)
      continue;

    history.push({
      role: "assistant",
      via: input.input.actor.platform,
      actor: null,
      text: row.text,
      at: row.createdAt,
    });
  }

  history.sort((left, right) => left.at - right.at);
  const devbox = yield* provisioning.current;
  const repository = yield* provisioning.repository;
  const candidates = yield* provisioning.candidates;
  const commands = yield* Commands.Service;
  const checkedOut = latestCheckout(yield* commands.snapshot);
  const instructions = yield* provisioning.instructions;

  return Briefing.make({
    taskId: task.id,
    initiatorId: task.reservation.initiatorId,
    devbox: devbox
      ? { phase: devbox.phase, resourceId: devbox.resourceId, lastReadyAt: devbox.lastReadyAt }
      : null,
    repositories: candidates.map(fullNameOf),
    repository: repository
      ? {
          fullName: fullNameOf(repository),
          branch: checkedOut?.branch ?? null,
          defaultBranch: checkedOut?.defaultBranch ?? checkedOut?.branch ?? null,
          branchPrefix: repository.branchPrefix,
          checkoutPath: checkedOut?.path ?? null,
        }
      : null,
    roles: instructions.roles.map((role) => ({
      name: role.name,
      summary:
        role.summary?.trim() ||
        (role.body.split("\n").find((line) => line.trim() !== "") ?? "").trim(),
    })),
    history,
    current: {
      role: "user",
      via: current.input.actor.platform,
      actor: current.input.actor.externalId,
      text: current.input.text,
      at: current.createdAt,
    },
  });
});

export const claim = Effect.fn("OperatorControl.claim")(function* (now: number) {
  const steps = yield* Steps.Service;
  const step = yield* steps.claim(now);
  if (!step) return null;

  const briefing = yield* brief(step.invocationId);

  if (!briefing) {
    // Inconsistent local state: fail the step rather than call a model blindly.
    yield* steps.record(step, { _tag: "Failed", failure: "missing-briefing" }, now);
    yield* settle(now);
    return null;
  }

  return { step, briefing } satisfies Claimed;
});

export const record = Effect.fn("OperatorControl.record")(function* (
  claimed: StepClaim,
  outcome: StepOutcome,
  now: number,
) {
  const steps = yield* Steps.Service;

  yield* steps.record(claimed, outcome, now);
  // Start durable work for new tool calls before the wake is recomputed.
  yield* dispatch(now);
  yield* resolveWaits(now);
  yield* settle(now);
});

export const nextWake = Effect.fn("OperatorControl.nextWake")(function* (now: number) {
  const state = yield* State.Service;
  const attempts = yield* Attempts.Service;
  const steps = yield* Steps.Service;
  const provisioning = yield* Provisioning.Service;
  const waiting = yield* steps.waiting(batchSize);
  const deadlines: Array<number> = [];

  for (const step of waiting)
    for (const call of step.calls) {
      const evaluation = yield* evaluate(step.id, call, now);
      if (evaluation._tag === "Resolved") return now;
      if (evaluation.deadline !== null) deadlines.push(evaluation.deadline);
    }

  if ((yield* state.missingHandoffs(yield* attempts.scheduledInputIds, 1)).length > 0) return now;

  const execution = yield* attempts.snapshot;
  const accepted = new Set(execution.outcomes.map((row) => row.invocationId));

  if ((yield* steps.settled(batchSize)).some((row) => !accepted.has(row.invocationId))) return now;

  if (
    (yield* state.missingResponses(
      execution.outcomes.map((row) => row.id),
      1,
    )).length > 0
  )
    return now;

  const times = [
    yield* state.nextWake(now),
    yield* steps.nextWake,
    waiting.length > 0 ? yield* provisioning.nextWake : null,
    ...deadlines,
  ].filter((at): at is number => at !== null);

  return times.length === 0 ? null : Math.max(now, Math.min(...times));
});
