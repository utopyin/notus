import * as Schema from "effect/Schema";

/** Provider-owned JSON, with separate routing metadata. No provider decoding or secret resolution. */
export const Environment = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  config: Schema.Json,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
});
export interface Environment extends Schema.Schema.Type<typeof Environment> {}

export const Fixture = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  teamId: Schema.NonEmptyString,
  channelId: Schema.NonEmptyString,
  /** An administrator-allowed repository whose pull request conversations may attach to tasks. */
  github: Schema.optionalKey(
    Schema.Struct({
      installationId: Schema.NonEmptyString,
      fullName: Schema.String.check(
        Schema.isPattern(/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/),
      ),
    }),
  ),
});
export interface Fixture extends Schema.Schema.Type<typeof Fixture> {}

export const StartGrant = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  initiatorId: Schema.NonEmptyString,
});
export interface StartGrant extends Schema.Schema.Type<typeof StartGrant> {}

/** GitHub adapter's opaque pull request conversation encoding: owner, repository, number. */
export const PullConversation = Schema.fromJsonString(
  Schema.Tuple([
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/)),
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/)),
    Schema.String.check(Schema.isPattern(/^[1-9]\d{0,9}$/)),
  ]),
);

/** Slack adapter's opaque conversation encoding. Timestamps are never floating-point values. */
export const Conversation = Schema.fromJsonString(
  Schema.Tuple([Schema.NonEmptyString, Schema.String.check(Schema.isPattern(/^\d+\.\d{6}$/))]),
);

export const Role = Schema.Literals(["admin", "member"]);
export type Role = typeof Role.Type;
const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const WorkspaceName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));
/** Path segments that are pages of their own, never a workspace. */
export const reservedSlugs = new Set([
  "account",
  "welcome",
  "invite",
  "sign-in",
  "auth",
  "api",
  "workspaces",
  "assets",
]);
export const Slug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,47}$/),
  Schema.makeFilter((value) => !reservedSlugs.has(value)),
);
/** The default slug for a name: its kebab-case form. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
export const Workspace = Schema.Struct({
  id: Schema.NonEmptyString,
  name: WorkspaceName,
  slug: Slug,
  createdBy: Schema.NonEmptyString,
  createdAt: Millis,
});
export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}
export const Membership = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  role: Role,
  provenance: Schema.NonEmptyString,
});
export interface Membership extends Schema.Schema.Type<typeof Membership> {}
export const Channel = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  teamId: Schema.NonEmptyString,
  channelId: Schema.NonEmptyString,
});
export interface Channel extends Schema.Schema.Type<typeof Channel> {}
export const Invite = Schema.Struct({
  id: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  role: Role,
  invitedBy: Schema.NonEmptyString,
  createdAt: Millis,
  expiresAt: Millis,
  acceptedBy: Schema.NullOr(Schema.NonEmptyString),
  acceptedAt: Schema.NullOr(Millis),
  revokedAt: Schema.NullOr(Millis),
});
export interface Invite extends Schema.Schema.Type<typeof Invite> {}
/** What a member sees of a workspace; invites appear for admins only. */
export const WorkspaceView = Schema.Struct({
  workspace: Workspace,
  role: Role,
  members: Schema.Array(Membership),
  channels: Schema.Array(Channel),
  invites: Schema.Array(Invite),
});
export interface WorkspaceView extends Schema.Schema.Type<typeof WorkspaceView> {}
