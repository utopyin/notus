import { Provider as ComputeProvider } from "@notus/compute/provider";
import { Platform } from "@notus/platform/platform";
import {
  ComputeConnection,
  Environment,
  Invite,
  Role,
  Workspace,
  WorkspaceTemplate,
} from "@notus/workspaces/types";
import * as Schema from "effect/Schema";

// What crosses the dashboard boundary. Imported by the dashboard's server, so this module and its
// imports hold schemas only, never services.

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** The signed-in user, their linked provider accounts and their workspaces. */
export const Me = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    slackTeamId: Schema.NullOr(Schema.String),
  }),
  accounts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      provider: Schema.String,
      accountId: Schema.String,
      createdAt: Schema.String,
    }),
  ),
  workspaces: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, slug: Schema.String, role: Role }),
  ),
});
export interface Me extends Schema.Schema.Type<typeof Me> {}

/** One of the user's sessions, never its token: revocation goes by ID. */
export const Session = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  current: Schema.Boolean,
});
export interface Session extends Schema.Schema.Type<typeof Session> {}

/** An installation with its platform's descriptor, so the dashboard never branches on the platform. */
export const InstallationSummary = Schema.Struct({
  workspaceId: Schema.String,
  platform: Platform,
  installationId: Schema.String,
  label: Schema.String,
  installedBy: Schema.String,
  installedAt: Millis,
  name: Schema.String,
  icon: Schema.String,
  scopeNoun: Schema.Struct({ one: Schema.String, many: Schema.String }),
});
export interface InstallationSummary extends Schema.Schema.Type<typeof InstallationSummary> {}

export const ScopeRow = Schema.Struct({
  workspaceId: Schema.String,
  platform: Platform,
  installationId: Schema.String,
  scope: Schema.String,
  label: Schema.String,
});
export interface ScopeRow extends Schema.Schema.Type<typeof ScopeRow> {}

/** A member row with the display profile of its user, once they signed in. */
export const Member = Schema.Struct({
  workspaceId: Schema.String,
  userId: Schema.String,
  role: Role,
  provenance: Schema.String,
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
});
export interface Member extends Schema.Schema.Type<typeof Member> {}

export const WorkspacePage = Schema.Struct({
  workspace: Workspace,
  role: Role,
  installations: Schema.Array(InstallationSummary),
  /** Which platforms this deployment can install; the dashboard offers exactly these. */
  installable: Schema.Array(Platform),
  scopes: Schema.Array(ScopeRow),
  invites: Schema.Array(Invite),
  members: Schema.Array(Member),
});
export interface WorkspacePage extends Schema.Schema.Type<typeof WorkspacePage> {}

/** A scope an installation can see, for admins choosing what a workspace covers. */
export const ScopeOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  member: Schema.Boolean,
  private: Schema.Boolean,
});
export interface ScopeOption extends Schema.Schema.Type<typeof ScopeOption> {}

/** What a build of the Notus template in one workspace's account last did. */
export const BuildView = Schema.Struct({
  status: Schema.Literals(["building", "ready", "failed"]),
  startedAt: Millis,
  finishedAt: Schema.NullOr(Millis),
  ref: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
});
export interface BuildView extends Schema.Schema.Type<typeof BuildView> {}

export const EnvironmentPage = Schema.Struct({
  provider: Schema.String,
  /** Every provider this deployment runs; the page offers a choice when there are several. */
  providers: Schema.Array(ComputeProvider),
  environment: Schema.NullOr(Environment),
  approvedImages: Schema.Array(Schema.String),
  workspaceImages: Schema.Array(WorkspaceTemplate),
  /** The template a configuration that selects none starts from, saved or inferred. */
  defaultImage: Schema.NullOr(Schema.String),
  connection: Schema.NullOr(ComputeConnection),
  /** The last build of the Notus template, where the provider builds one. */
  build: Schema.NullOr(BuildView),
});
export interface EnvironmentPage extends Schema.Schema.Type<typeof EnvironmentPage> {}

// A task as the dashboard shows it: projections of its object's state, plain strings throughout.

export const TaskStatus = Schema.Literals([
  "queued",
  "working",
  "waiting",
  "idle",
  "failed",
  "closed",
]);
export type TaskStatus = typeof TaskStatus.Type;

export const ConversationView = Schema.Struct({
  platform: Schema.String,
  scope: Schema.String,
  conversation: Schema.String,
});
export interface ConversationView extends Schema.Schema.Type<typeof ConversationView> {}

/** One durable command: what was asked, and what the box or control reported. */
export const CommandView = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  status: Schema.Literals(["pending", "claimed", "done", "failed"]),
  /** One line: the repository, branch, agent or pull request title. */
  subject: Schema.String,
  /** The script, instructions or message the command carried. */
  input: Schema.NullOr(Schema.String),
  output: Schema.NullOr(
    Schema.Struct({
      exitCode: Schema.NullOr(Schema.Finite),
      durationMs: Schema.Finite,
      timedOut: Schema.Boolean,
      truncated: Schema.Boolean,
      stdout: Schema.String,
      stderr: Schema.String,
      /** The specialist's report, for rounds that wrote one. */
      report: Schema.NullOr(Schema.String),
    }),
  ),
  link: Schema.NullOr(Schema.Struct({ label: Schema.String, url: Schema.String })),
  failure: Schema.NullOr(Schema.String),
  createdAt: Schema.Finite,
  claimedAt: Schema.NullOr(Schema.Finite),
  updatedAt: Schema.Finite,
});
export interface CommandView extends Schema.Schema.Type<typeof CommandView> {}

export const StepItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("reasoning"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("tool"),
    id: Schema.String,
    name: Schema.String,
    params: Schema.Json,
    state: Schema.Literals(["waiting", "done", "failed"]),
    /** What the model was given back, when no command carries the result. */
    result: Schema.Json,
    command: Schema.NullOr(CommandView),
  }),
]);
export type StepItem = typeof StepItem.Type;

/** One model round of the operator. */
export const StepView = Schema.Struct({
  id: Schema.String,
  index: Schema.Finite,
  status: Schema.Literals(["pending", "running", "waiting", "done", "failed"]),
  attempts: Schema.Finite,
  failure: Schema.NullOr(Schema.String),
  tokens: Schema.NullOr(Schema.Finite),
  items: Schema.Array(StepItem),
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
});
export interface StepView extends Schema.Schema.Type<typeof StepView> {}

export const ResponseView = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  final: Schema.Boolean,
  delivery: Schema.NullOr(Schema.String),
  createdAt: Schema.Finite,
});
export interface ResponseView extends Schema.Schema.Type<typeof ResponseView> {}

/** One admitted input and everything the operator did for it. */
export const TurnView = Schema.Struct({
  inputId: Schema.String,
  platform: Schema.String,
  author: Schema.String,
  text: Schema.String,
  answered: Schema.Boolean,
  createdAt: Schema.Finite,
  steps: Schema.Array(StepView),
  responses: Schema.Array(ResponseView),
});
export interface TurnView extends Schema.Schema.Type<typeof TurnView> {}

export const TaskSummary = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  initiatorId: Schema.String,
  mode: Schema.String,
  status: TaskStatus,
  /** What the task is doing right now, in a few words; null when idle. */
  activity: Schema.NullOr(Schema.String),
  /** The message that started the task. */
  request: Schema.String,
  origin: ConversationView,
  repository: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(Schema.Struct({ number: Schema.Finite, url: Schema.String })),
  turns: Schema.Finite,
  steps: Schema.Finite,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
  closedAt: Schema.NullOr(Schema.Finite),
});
export interface TaskSummary extends Schema.Schema.Type<typeof TaskSummary> {}

export const TaskDetail = Schema.Struct({
  ...TaskSummary.fields,
  sources: Schema.Array(Schema.Struct({ ...ConversationView.fields, origin: Schema.Boolean })),
  devbox: Schema.NullOr(
    Schema.Struct({
      provider: Schema.String,
      phase: Schema.String,
      blockedReason: Schema.NullOr(Schema.String),
      resourceId: Schema.NullOr(Schema.String),
      lastReadyAt: Schema.NullOr(Schema.Finite),
    }),
  ),
  /** The specialist roles captured when the task started, by revision. */
  roles: Schema.Array(Schema.Struct({ name: Schema.String, revision: Schema.Finite })),
  timeline: Schema.Array(TurnView),
});
export interface TaskDetail extends Schema.Schema.Type<typeof TaskDetail> {}

/** Who started a task, as far as their profile is known. */
const Initiator = Schema.NullOr(
  Schema.Struct({ name: Schema.String, image: Schema.NullOr(Schema.String) }),
);

export const TaskRow = Schema.Struct({ ...TaskSummary.fields, initiator: Initiator });
export interface TaskRow extends Schema.Schema.Type<typeof TaskRow> {}

export const TaskPage = Schema.Struct({ ...TaskDetail.fields, initiator: Initiator });
export interface TaskPage extends Schema.Schema.Type<typeof TaskPage> {}
