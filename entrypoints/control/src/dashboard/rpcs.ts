import { ConnectionStatus, DeviceLogin } from "@notus/accounts/types";
import { Provider as ModelProvider } from "@notus/openai/types";
import { Platform } from "@notus/platform/platform";
import {
  ComputeConnection,
  Environment,
  EnvironmentRevision,
  Invite,
  Role,
  RoleRevision,
  SpecialistRole,
  Workspace,
  WorkspaceTemplate,
} from "@notus/workspaces/types";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import {
  BuildView,
  EnvironmentPage,
  Me,
  ScopeOption,
  Session,
  TaskPage,
  TaskRow,
  WorkspacePage,
} from "./types";

// The dashboard's API: Effect RPC over HTTP at `/rpc`, authenticated by the dashboard's session
// cookie. The dashboard's server imports this module, so it holds the contract only.

/** Every refusal the dashboard sees: a short reason it shows or branches on, never a cause. */
export class DashboardError extends Schema.TaggedError<DashboardError>()("DashboardError", {
  reason: Schema.String,
}) {}

/** The signed-in user a call acts for, resolved from the forwarded cookie, never trusted from it. */
export interface SignedIn {
  readonly userId: string;
  readonly sessionId: string;
  /** The credential the call presented, for calls that act on the user's own sessions. */
  readonly cookie: string;
  readonly now: number;
}

export class Viewer extends Context.Service<Viewer, SignedIn>()(
  "@notus/control/dashboard/Viewer",
) {}

/** Resolves the session for every call that needs one; an anonymous call fails as unauthorized. */
export class Authentication extends RpcMiddleware.Service<Authentication, { provides: Viewer }>()(
  "@notus/control/dashboard/Authentication",
  { error: DashboardError },
) {}

const call = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error: DashboardError });

const Json = Schema.Json;

const ScopeInput = Schema.Struct({
  platform: Platform,
  installationId: Schema.String,
  scope: Schema.String,
  label: Schema.optionalKey(Schema.String),
});

/** Anonymous requests get null; nothing here is a secret. */
export class MeRpcs extends RpcGroup.make(
  Rpc.make("me", { success: Schema.NullOr(Me), error: DashboardError }),
) {}

export class AccountRpcs extends RpcGroup.make(
  call("sessions", {}, Schema.Array(Session)),
  call("revokeSession", { sessionId: Schema.String }, Schema.Void),
  call("connections", {}, Schema.Array(ConnectionStatus)),
  /** Starts "Sign in with ChatGPT" by device code; the page shows the code and the link. */
  call("beginChatGpt", {}, DeviceLogin),
  call("pollChatGpt", {}, DeviceLogin),
  /** A pasted platform API key: fingerprinted for status, sealed for storage, never shown again. */
  call("linkApiKey", { key: Schema.String }, ConnectionStatus),
  call("revokeConnection", { provider: ModelProvider }, ConnectionStatus),
).middleware(Authentication) {}

const WorkspaceId = { workspaceId: Schema.String };
const Installation = { ...WorkspaceId, platform: Platform, installationId: Schema.String };

export class WorkspaceRpcs extends RpcGroup.make(
  call(
    "createWorkspace",
    { name: Schema.String, slug: Schema.optionalKey(Schema.String) },
    Workspace,
  ),
  call(
    "updateWorkspace",
    {
      ...WorkspaceId,
      name: Schema.optionalKey(Schema.String),
      slug: Schema.optionalKey(Schema.String),
    },
    Workspace,
  ),
  call("workspace", WorkspaceId, WorkspacePage),
  call("workspaceBySlug", { slug: Schema.String }, WorkspacePage),
  call("setRole", { ...WorkspaceId, userId: Schema.String, role: Role }, Schema.Void),
  call("removeMember", { ...WorkspaceId, userId: Schema.String }, Schema.Void),
  call(
    "createInvite",
    { ...WorkspaceId, role: Role },
    Schema.Struct({ invite: Invite, token: Schema.String }),
  ),
  call("revokeInvite", { ...WorkspaceId, inviteId: Schema.String }, Schema.Void),
  call("acceptInvite", { token: Schema.String }, Workspace),
  /** Where to send an admin to install a platform; the intent outlives the round trip. */
  call("installUrl", { ...WorkspaceId, platform: Platform }, Schema.Struct({ url: Schema.String })),
  /** The platform's redirect, back with the session cookie: where to send the browser next. */
  call(
    "completeInstall",
    { platform: Schema.String, search: Schema.String },
    Schema.Struct({ location: Schema.String }),
  ),
  call("uninstall", Installation, Schema.Void),
  call("addScope", { ...WorkspaceId, source: ScopeInput }, Schema.Void),
  call("removeScope", { ...WorkspaceId, source: ScopeInput }, Schema.Void),
  /** The scopes an installation can see; only the workspace that installed it may ask. */
  call("listScopes", Installation, Schema.Struct({ scopes: Schema.Array(ScopeOption) })),
).middleware(Authentication) {}

export class TaskRpcs extends RpcGroup.make(
  call("tasks", WorkspaceId, Schema.Array(TaskRow)),
  call("task", { ...WorkspaceId, taskId: Schema.String }, TaskPage),
).middleware(Authentication) {}

const RoleName = { ...WorkspaceId, name: Schema.String };

export class RoleRpcs extends RpcGroup.make(
  call("roles", WorkspaceId, Schema.Array(SpecialistRole)),
  call("roleHistory", RoleName, Schema.Array(RoleRevision)),
  call("saveRole", { ...RoleName, summary: Schema.String, body: Schema.String }, SpecialistRole),
  call("deleteRole", RoleName, Schema.Void),
).middleware(Authentication) {}

const ProviderOf = { ...WorkspaceId, provider: Schema.String };

export class DevboxRpcs extends RpcGroup.make(
  call("environment", { ...WorkspaceId, provider: Schema.NullOr(Schema.String) }, EnvironmentPage),
  call("environmentHistory", WorkspaceId, Schema.Array(EnvironmentRevision)),
  /** The provider's policy decides before anything is stored; its message is the reason. */
  call("saveEnvironment", { ...ProviderOf, config: Json }, Environment),
  call(
    "addImage",
    { ...ProviderOf, ref: Schema.String, label: Schema.String },
    Schema.Array(WorkspaceTemplate),
  ),
  call("removeImage", { ...ProviderOf, ref: Schema.String }, Schema.Array(WorkspaceTemplate)),
  /** Null clears the default; a launch then needs a configuration that selects a template. */
  call(
    "setDefaultImage",
    { ...ProviderOf, ref: Schema.NullOr(Schema.String) },
    Schema.Array(WorkspaceTemplate),
  ),
  /** The credential is sealed on write; no response carries it back. */
  call(
    "connectCompute",
    { ...ProviderOf, credential: Json, label: Schema.String },
    Schema.NullOr(ComputeConnection),
  ),
  call("buildTemplate", ProviderOf, BuildView),
  call("disconnectCompute", ProviderOf, Schema.Void),
).middleware(Authentication) {}

export class DashboardRpcs extends MeRpcs.merge(
  AccountRpcs,
  WorkspaceRpcs,
  TaskRpcs,
  RoleRpcs,
  DevboxRpcs,
) {}
