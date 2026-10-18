import { Resource } from "@notus/compute/adapter";
import { ReplyTarget, Source } from "@notus/platform/source";
import { Environment } from "@notus/workspaces/types";
import * as Schema from "effect/Schema";

export const Mode = Schema.Literals(["simulation", "readiness", "operator"]);
export type Mode = typeof Mode.Type;
export const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const Observation = Schema.Struct({
  operationId: Schema.NonEmptyString,
  attemptId: Schema.NonEmptyString,
  generation: Schema.Int.check(Schema.isGreaterThan(0)),
  invocationId: Schema.NonEmptyString,
  inputId: Schema.NonEmptyString,
  resultId: Schema.NonEmptyString,
  content: Schema.String,
  digest: Schema.NonEmptyString,
});
export interface Observation extends Schema.Schema.Type<typeof Observation> {}

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

export const Phase = Schema.Literals([
  "pending-create",
  "creating",
  "ambiguous-create",
  "created",
  "activating",
  "awaiting-readiness",
  "ready",
  "blocked",
]);
export const BlockReason = Schema.Literals([
  "missing-environment",
  "create-unresolved",
  "activation-unresolved",
  "startup-timeout",
  "provider-rejected",
  "external-expired",
  "recovery-unverified",
]);
export const Initialize = Schema.Struct({
  taskId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  environment: Schema.NullOr(Environment),
});
export interface Initialize extends Schema.Schema.Type<typeof Initialize> {}

/** Identity, not a bearer credential. Control signs/authenticates this binding. */
export const Bootstrap = Schema.Struct({
  taskId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  attemptId: Schema.NonEmptyString,
  generation: Positive,
  operationId: Schema.NonEmptyString,
  capabilityId: Schema.NonEmptyString,
});
export interface Bootstrap extends Schema.Schema.Type<typeof Bootstrap> {}

export { Resource } from "@notus/compute/adapter";
export const Work = Schema.Literals([
  "create",
  "reconcile-create",
  "activate",
  "reconcile-activation",
  "probe-wake",
]);
export const Claim = Schema.Struct({
  bootstrap: Bootstrap,
  claimGeneration: Positive,
  work: Work,
  recoverAt: Millis,
  providerName: Schema.NonEmptyString,
  launchVersion: Schema.Literal(1),
  environment: Environment,
  resource: Schema.NullOr(Resource),
});
export interface Claim extends Schema.Schema.Type<typeof Claim> {}

/** Trusted adapter reports. Unknown responses must use Lost. */
export const ProvisioningResult = Schema.TaggedUnion({
  Assigned: {
    operationId: Schema.NonEmptyString,
    resource: Resource,
    verified: Schema.Literal(true),
  },
  Lost: {},
  NotFound: {},
  Unproven: {},
  Activated: { resourceId: Schema.NonEmptyString, instanceId: Schema.NonEmptyString },
  Running: { resourceId: Schema.NonEmptyString, instanceId: Schema.NonEmptyString },
  Stopped: { resourceId: Schema.NonEmptyString, verified: Schema.Literal(true) },
  Rejected: {},
  ExternalExpire: { resourceId: Schema.NonEmptyString },
});
export type ProvisioningResult = typeof ProvisioningResult.Type;

export const EnrollmentIdentity = Schema.Struct({
  bootstrap: Bootstrap,
  resourceId: Schema.NonEmptyString,
  instanceId: Schema.NonEmptyString,
  expectedRecoveryRevision: Millis,
  requestId: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  kernelBootId: Schema.NonEmptyString,
});
export interface EnrollmentIdentity extends Schema.Schema.Type<typeof EnrollmentIdentity> {}
export const Enrollment = Schema.Struct({
  ...EnrollmentIdentity.fields,
  /** Only Control may assert verified-new-boot after checking independent evidence. */
  bootEvidence: Schema.Literals(["initial", "verified-new-boot"]),
  /** Trusted provider-adapter receipt, never evidence supplied by the callback body. */
  previousTermination: Schema.NullOr(
    Schema.Struct({
      instanceId: Schema.NonEmptyString,
      endedAt: Schema.NonEmptyString.check(
        Schema.isPattern(
          /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/,
        ),
        Schema.makeFilter((value) => {
          const year = Number(value.slice(0, 4));
          const month = Number(value.slice(5, 7));
          const day = Number(value.slice(8, 10));
          const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
          const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

          return day <= days;
        }),
      ),
    }),
  ),
});
export interface Enrollment extends Schema.Schema.Type<typeof Enrollment> {}
/** Internal enrollment context. Never expose this as a task snapshot or callback response. */
export const EnrollmentContext = Schema.Struct({
  bootstrap: Bootstrap,
  /** Which provider holds the resource; what the provider-facing checks resolve. */
  environment: Schema.NullOr(Environment),
  resource: Schema.NullOr(Resource),
  previous: Schema.NullOr(Enrollment),
  phase: Phase,
  recoveryRevision: Millis,
  enrollmentExpected: Schema.Boolean,
  activationConfirmed: Schema.Boolean,
});
export interface EnrollmentContext extends Schema.Schema.Type<typeof EnrollmentContext> {}
export const EpochGrant = Schema.Struct({
  epoch: Positive,
  challenge: Schema.NonEmptyString,
  nextRecoveryRevision: Positive,
});
export interface EpochGrant extends Schema.Schema.Type<typeof EpochGrant> {}
export const Readiness = Schema.Struct({
  bootstrap: Bootstrap,
  resourceId: Schema.NonEmptyString,
  instanceId: Schema.NonEmptyString,
  epoch: Positive,
  runId: Schema.NonEmptyString,
  challenge: Schema.NonEmptyString,
  observationId: Schema.NonEmptyString,
  protocol: Schema.Literal(22),
  herdrVersion: Schema.Literal("0.9.0"),
  taskAuthorized: Schema.Literal(false),
});
export interface Readiness extends Schema.Schema.Type<typeof Readiness> {}
export const ReadinessReceipt = Schema.Struct({ observation: Readiness, acceptedAt: Millis });
export interface ReadinessReceipt extends Schema.Schema.Type<typeof ReadinessReceipt> {}

/** Last observed state. No config, native image, capability ID, challenge or callback credential
 * is exposed.
 */
export const ProvisioningStatus = Schema.Struct({
  attemptId: Schema.NonEmptyString,
  taskId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  generation: Positive,
  active: Schema.Boolean,
  phase: Phase,
  pendingWork: Schema.NullOr(Work),
  providerName: Schema.NonEmptyString,
  blockedReason: Schema.NullOr(BlockReason),
  resourceId: Schema.NullOr(Schema.NonEmptyString),
  instanceId: Schema.NullOr(Schema.NonEmptyString),
  runtimeEpoch: Millis,
  lastReadyAt: Schema.NullOr(Millis),
  lastReadyEpoch: Schema.NullOr(Positive),
  observedAt: Millis,
  taskAuthorized: Schema.Literal(false),
});
export interface ProvisioningStatus extends Schema.Schema.Type<typeof ProvisioningStatus> {}
export const WakeReceipt = Schema.Struct({
  inputId: Schema.NonEmptyString,
  requestedAt: Millis,
  status: ProvisioningStatus,
});
export interface WakeReceipt extends Schema.Schema.Type<typeof WakeReceipt> {}

/** Directories a command may use: the workspace root or one checkout directly under it. */
export const WorkspacePath = Schema.String.check(
  Schema.isPattern(/^\/workspaces(\/[A-Za-z0-9._-]{1,100})?$/),
);
const Timeout = Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 600_000 }));

/**
 * A repository a task may work in: one the workspace covers through a GitHub installation. The
 * default branch is whatever the remote reports.
 */
export const RepositoryRef = Schema.Struct({
  owner: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/)),
  name: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/)),
  /** The App installation that reaches it; every token for it is minted there. */
  installationId: Schema.String.check(Schema.isPattern(/^\d{1,20}$/)),
  /** The initiator's login; every branch the task pushes lives under it. */
  branchPrefix: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,38}$/)),
});
export interface RepositoryRef extends Schema.Schema.Type<typeof RepositoryRef> {}
export const BranchPrefix = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,38}$/));
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
/**
 * What executes for the operator. shell, checkout, push and specialist run on the dev box
 * runtime; pull-request and update run in the control plane with its own credentials.
 */
export const CommandSpec = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("shell"),
    script: Schema.NonEmptyString.check(Schema.isMaxLength(8192)),
    cwd: WorkspacePath,
    timeoutMs: Timeout,
  }),
  Schema.Struct({
    kind: Schema.Literal("checkout"),
    repository: RepositoryRef,
    path: WorkspacePath,
    /** Land on this pull request's head branch instead of the default branch. */
    pullRequest: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    timeoutMs: Timeout,
  }),
  Schema.Struct({
    /** Publish the checkout's existing commits to a branch. */
    kind: Schema.Literal("push"),
    repository: RepositoryRef,
    path: WorkspacePath,
    branch: TaskBranch,
    timeoutMs: Timeout,
  }),
  Schema.Struct({
    /** One specialist round: a Codex agent on the box works on the checkout and writes a report. */
    kind: Schema.Literal("specialist"),
    /** The Herdr agent name; the same name reuses the same live agent across rounds. */
    agent: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/)),
    instructions: Schema.NonEmptyString.check(Schema.isMaxLength(32_000)),
    path: WorkspacePath,
    timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 60_000, maximum: 3_600_000 })),
  }),
  Schema.Struct({
    /** A message posted in the conversation where the task started, mid-turn; control sends it. */
    kind: Schema.Literal("update"),
    target: ReplyTarget,
    text: Schema.NonEmptyString.check(Schema.isMaxLength(4000)),
    timeoutMs: Timeout,
  }),
  Schema.Struct({
    kind: Schema.Literal("pull-request"),
    repository: RepositoryRef,
    branch: TaskBranch,
    /** The repository's default branch, as the checkout reported it. */
    base: TaskBranch,
    title: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    body: Schema.String.check(Schema.isMaxLength(60_000)),
    timeoutMs: Timeout,
  }),
]);
export type CommandSpec = typeof CommandSpec.Type;
export const executorOf = (spec: CommandSpec): "runtime" | "control" =>
  spec.kind === "pull-request" || spec.kind === "update" ? "control" : "runtime";
export const Command = Schema.Struct({ id: Schema.NonEmptyString, spec: CommandSpec });
export interface Command extends Schema.Schema.Type<typeof Command> {}
/** Bounded observation the runtime reports; output is truncated. */
export const CommandResult = Schema.Struct({
  exitCode: Schema.NullOr(Schema.Int),
  stdout: Schema.String.check(Schema.isMaxLength(65_536)),
  stderr: Schema.String.check(Schema.isMaxLength(65_536)),
  durationMs: Millis,
  timedOut: Schema.Boolean,
  truncated: Schema.Boolean,
  /** Present for successful checkouts only. */
  checkout: Schema.optionalKey(
    Schema.Struct({
      path: WorkspacePath,
      branch: Schema.NonEmptyString,
      headSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
      /** The remote's default branch; absent from results of runtimes before image v11. */
      defaultBranch: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  /** Present for successful pushes only. */
  push: Schema.optionalKey(
    Schema.Struct({
      branch: TaskBranch,
      headSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
    }),
  ),
  /** Present for specialist rounds whose agent wrote its report. */
  specialist: Schema.optionalKey(
    Schema.Struct({ report: Schema.String.check(Schema.isMaxLength(65_536)) }),
  ),
  /** Present for updates the origin conversation confirmed. */
  update: Schema.optionalKey(Schema.Struct({ reference: Schema.NonEmptyString })),
  /** Present for successfully opened pull requests only. */
  pullRequest: Schema.optionalKey(
    Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThan(0)),
      url: Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\/[^\s]+$/)),
      branch: TaskBranch,
      /** The conversation Notus opened; feedback there may attach to this task. */
      source: Source,
    }),
  ),
});
export interface CommandResult extends Schema.Schema.Type<typeof CommandResult> {}
export const CommandObservation = Schema.Struct({
  commandId: Schema.NonEmptyString,
  result: CommandResult,
});
export interface CommandObservation extends Schema.Schema.Type<typeof CommandObservation> {}

/** Non-cryptographic content checksum. Acceptance also compares the complete content.
 * This is never an authentication token, signature, or authority check.
 */
export const digest = (content: string): string => {
  let hash = 0xcbf29ce484222325n;

  for (const byte of new TextEncoder().encode(content)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
};
