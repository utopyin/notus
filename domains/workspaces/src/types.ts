import { InstallationId, PlatformId } from "@notus/platform/ids";
import { Platform } from "@notus/platform/platform";
import * as Schema from "effect/Schema";

/** Provider-owned JSON, with separate routing metadata. No provider decoding or secret resolution. */
export const Environment = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  config: Schema.Json,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
});
export interface Environment extends Schema.Schema.Type<typeof Environment> {}

export const StartGrant = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  initiatorId: Schema.NonEmptyString,
});
export interface StartGrant extends Schema.Schema.Type<typeof StartGrant> {}

/** Who asked to install what; what the platform's redirect is matched against. */
export const InstallIntent = Schema.Struct({
  nonce: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  platform: Platform,
});
export interface InstallIntent extends Schema.Schema.Type<typeof InstallIntent> {}

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
export const Installation = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  platform: Platform,
  installationId: InstallationId,
  label: Schema.String,
  installedBy: Schema.NonEmptyString,
  installedAt: Millis,
});
export interface Installation extends Schema.Schema.Type<typeof Installation> {}
/** A scope of an installation the workspace covers; the label is what the platform called it when chosen. */
export const WorkspaceScope = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  platform: Platform,
  installationId: InstallationId,
  scope: PlatformId,
  label: Schema.String,
});
export interface WorkspaceScope extends Schema.Schema.Type<typeof WorkspaceScope> {}
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
  installations: Schema.Array(Installation),
  scopes: Schema.Array(WorkspaceScope),
  invites: Schema.Array(Invite),
});
export interface WorkspaceView extends Schema.Schema.Type<typeof WorkspaceView> {}

/** A role name doubles as the specialist agent's name on the box, so it follows the same rule. */
export const RoleName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/));
export const RoleBody = Schema.String.check(Schema.isMaxLength(16_000));
/** One line, what the operator reads when choosing which specialist to run. */
export const RoleSummary = Schema.String.check(Schema.isMaxLength(200));
export const SpecialistRole = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  name: RoleName,
  summary: RoleSummary,
  body: RoleBody,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
  authorId: Schema.NonEmptyString,
  createdAt: Millis,
  updatedAt: Millis,
});
export interface SpecialistRole extends Schema.Schema.Type<typeof SpecialistRole> {}
export const RoleRevision = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
  summary: RoleSummary,
  body: RoleBody,
  authorId: Schema.NonEmptyString,
  createdAt: Millis,
});
export interface RoleRevision extends Schema.Schema.Type<typeof RoleRevision> {}
/** What a task captures when it starts: the roles it may give a specialist, at their revision then. */
export const ResolvedInstructions = Schema.Struct({
  roles: Schema.Array(
    Schema.Struct({
      name: RoleName,
      revision: Schema.Int.check(Schema.isGreaterThan(0)),
      /** Absent in tasks captured before summaries existed; the body's first line stood in for it. */
      summary: Schema.optionalKey(RoleSummary),
      body: RoleBody,
    }),
  ),
});
export interface ResolvedInstructions extends Schema.Schema.Type<typeof ResolvedInstructions> {}
