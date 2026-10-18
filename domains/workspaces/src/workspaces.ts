import { SharedDb } from "@notus/db/shared";
import { Sealed } from "@notus/cloudflare/sealed";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import { Platform } from "@notus/platform/platform";
import { key } from "@notus/platform/source";
import { and, eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { WorkspaceError } from "./errors";
import { defaultRoleStatements } from "./roles";
import {
  installIntents,
  installations,
  invites,
  memberships,
  scopes,
  workspaces,
} from "@notus/db/schema/shared";
import {
  Installation,
  InstallIntent,
  Invite,
  Membership,
  Role,
  Slug,
  slugOf,
  Workspace,
  WorkspaceScope,
  WorkspaceName,
  WorkspaceView,
} from "./types";

/**
 * Workspace administration for the dashboard. Every mutation takes the acting user and checks
 * their role here, so callers only have to prove who the user is. Invite tokens are returned once
 * and stored hashed; nothing here returns a secret.
 */
export interface Interface {
  /** The slug defaults to the name's kebab-case form; a taken or reserved slug is a conflict. */
  readonly create: (
    actorId: string,
    input: { readonly name: string; readonly slug?: string | undefined },
    now: number,
  ) => Effect.Effect<Workspace, WorkspaceError>;
  /** Admin-only rename or re-slug. */
  readonly update: (
    workspaceId: string,
    actorId: string,
    input: { readonly name?: string | undefined; readonly slug?: string | undefined },
  ) => Effect.Effect<Workspace, WorkspaceError>;
  readonly viewBySlug: (
    slug: string,
    userId: string,
  ) => Effect.Effect<WorkspaceView, WorkspaceError>;
  readonly listMine: (
    userId: string,
  ) => Effect.Effect<ReadonlyArray<Workspace & { readonly role: Role }>, WorkspaceError>;
  readonly view: (
    workspaceId: string,
    userId: string,
  ) => Effect.Effect<WorkspaceView, WorkspaceError>;
  /** The user's role in the workspace; forbidden when they are not a member. */
  readonly role: (workspaceId: string, userId: string) => Effect.Effect<Role, WorkspaceError>;
  readonly setRole: (
    workspaceId: string,
    actorId: string,
    userId: string,
    role: Role,
  ) => Effect.Effect<void, WorkspaceError>;
  readonly removeMember: (
    workspaceId: string,
    actorId: string,
    userId: string,
  ) => Effect.Effect<void, WorkspaceError>;
  /** Returns the invite row and its token; the token is never stored or shown again. */
  readonly createInvite: (
    workspaceId: string,
    actorId: string,
    role: Role,
    now: number,
  ) => Effect.Effect<{ readonly invite: Invite; readonly token: string }, WorkspaceError>;
  readonly revokeInvite: (
    workspaceId: string,
    actorId: string,
    inviteId: string,
    now: number,
  ) => Effect.Effect<void, WorkspaceError>;
  /** Accepts a token for the signed-in user; returns the workspace joined. */
  readonly acceptInvite: (
    token: string,
    userId: string,
    now: number,
  ) => Effect.Effect<Workspace, WorkspaceError>;
  /** An admin is about to be sent to a platform; the nonce comes back with the platform's redirect. */
  readonly beginInstall: (
    workspaceId: string,
    actorId: string,
    platform: Platform,
    now: number,
  ) => Effect.Effect<InstallIntent, WorkspaceError>;
  /** Consumes the intent the platform's redirect carries; "expired" once used or too old. */
  readonly takeInstallIntent: (
    nonce: string,
    now: number,
  ) => Effect.Effect<InstallIntent, WorkspaceError>;
  /**
   * Records a confirmed installation. Completing the platform's consent proves authority over the
   * team or account, so an installation another workspace held moves here, scopes and all.
   */
  readonly install: (
    intent: InstallIntent,
    installed: {
      readonly installationId: string;
      readonly label: string;
      readonly credential: Schema.Json;
    },
    now: number,
  ) => Effect.Effect<Installation, WorkspaceError>;
  /** Forgets an installation and every scope covered through it. */
  readonly uninstall: (
    workspaceId: string,
    actorId: string,
    ref: { readonly platform: Platform; readonly installationId: string },
  ) => Effect.Effect<void, WorkspaceError>;
  /** Covers a scope of a platform the workspace has installed; "not-installed" otherwise. */
  readonly addScope: (
    workspaceId: string,
    actorId: string,
    source: ScopeInput,
  ) => Effect.Effect<void, WorkspaceError>;
  readonly removeScope: (
    workspaceId: string,
    actorId: string,
    source: ScopeInput,
  ) => Effect.Effect<void, WorkspaceError>;
}
export class Service extends Context.Service<Service, Interface>()(
  "@notus/workspaces/workspaces/Service",
) {}

const WorkspaceRow = createSelectSchema(workspaces);
const MemberRow = createSelectSchema(memberships);
const InstallationRow = createSelectSchema(installations);
const IntentRow = createSelectSchema(installIntents);
const ScopeRow = createSelectSchema(scopes);
const installIntentLifetimeMs = 15 * 60_000;
const credentialJson = Schema.fromJsonString(Schema.Json);
const InviteRow = createSelectSchema(invites);
const inviteLifetimeMs = 7 * 24 * 60 * 60_000;

const fail = (operation: string, reason: WorkspaceError["reason"]) =>
  new WorkspaceError({ operation, reason });

const ScopeInput = Schema.Struct({
  platform: Platform,
  installationId: InstallationId,
  scope: PlatformId,
  label: Schema.optionalKey(Schema.String),
});

/** What a caller supplies; the brands are applied by decoding. */
export interface ScopeInput {
  readonly platform: Platform;
  readonly installationId: string;
  readonly scope: string;
  readonly label?: string;
}

export const layerNoDeps = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SharedDb.Service;
    const crypto = yield* Crypto.Crypto;
    const sealed = yield* Sealed.Service;

    const storage =
      (operation: string) =>
      <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.mapError((error) =>
            Schema.is(WorkspaceError)(error)
              ? error
              : fail(operation, Schema.isSchemaError(error) ? "invalid-input" : "storage"),
          ),
        );

    const decodeInput = <A, I>(schema: Schema.Codec<A, I>, value: I, operation: string) =>
      Schema.decodeEffect(schema)(value).pipe(
        Effect.mapError(() => fail(operation, "invalid-input")),
      );

    const workspace = (operation: string, workspaceId: string) =>
      store.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(WorkspaceRow))),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(fail(operation, "not-found"))
              : Effect.succeed(rows[0]),
          ),
        );

    const members = (workspaceId: string) =>
      store.db
        .select()
        .from(memberships)
        .where(eq(memberships.workspaceId, workspaceId))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))));

    const roleOf = (operation: string, workspaceId: string, userId: string) =>
      store.db
        .select()
        .from(memberships)
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(MemberRow))),
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(fail(operation, "forbidden"))
              : Effect.succeed(rows[0].role),
          ),
        );

    const requireAdmin = (operation: string, workspaceId: string, actorId: string) =>
      roleOf(operation, workspaceId, actorId).pipe(
        Effect.flatMap((role) =>
          role === "admin" ? Effect.void : Effect.fail(fail(operation, "forbidden")),
        ),
      );

    const slugTaken = (slug: string) =>
      store.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .pipe(Effect.map((rows) => rows.length > 0));

    // Web Crypto's UUID cannot fail on a Worker; a failure here would be a defect, not a result.
    const uuid = crypto.randomUUIDv4().pipe(Effect.orDie);

    const tokenHash = (token: string) =>
      crypto
        .digest("SHA-256", new TextEncoder().encode(token))
        .pipe(Effect.map(Hex.encode), Effect.orDie);

    const create = Effect.fn("Workspaces.create")(function* (
      actorId: string,
      input: { readonly name: string; readonly slug?: string | undefined },
      now: number,
    ) {
      const name = yield* decodeInput(WorkspaceName, input.name.trim(), "create");
      const slug = yield* decodeInput(Slug, (input.slug ?? slugOf(name)).trim(), "create");

      if (yield* slugTaken(slug).pipe(storage("create"))) return yield* fail("create", "conflict");

      const id = yield* uuid;

      yield* store
        .batch([
          sql`INSERT INTO workspaces (id, name, slug, createdBy, createdAt)
          VALUES (${id}, ${name}, ${slug}, ${actorId}, ${now})`,
          sql`INSERT INTO workspace_memberships (key, workspaceId, userId, role, provenance)
          VALUES (${key(id, actorId)}, ${id}, ${actorId}, 'admin', 'dashboard')`,
          ...defaultRoleStatements(id, actorId, now),
        ])
        .pipe(storage("create"));

      return Workspace.make({ id, name, slug, createdBy: actorId, createdAt: now });
    });

    const update = Effect.fn("Workspaces.update")(function* (
      workspaceId: string,
      actorId: string,
      input: { readonly name?: string | undefined; readonly slug?: string | undefined },
    ) {
      yield* requireAdmin("update", workspaceId, actorId).pipe(storage("update"));
      const current = yield* workspace("update", workspaceId).pipe(storage("update"));

      const name =
        input.name === undefined
          ? current.name
          : yield* decodeInput(WorkspaceName, input.name.trim(), "update");

      const slug =
        input.slug === undefined
          ? current.slug
          : yield* decodeInput(Slug, input.slug.trim(), "update");

      if (slug !== current.slug && (yield* slugTaken(slug).pipe(storage("update"))))
        return yield* fail("update", "conflict");

      yield* store.db
        .update(workspaces)
        .set({ name, slug })
        .where(eq(workspaces.id, workspaceId))
        .pipe(storage("update"));

      return Workspace.make({ ...current, name, slug });
    });

    const viewBySlug = Effect.fn("Workspaces.viewBySlug")(function* (slug: string, userId: string) {
      const rows = yield* store.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .pipe(storage("viewBySlug"));
      const id = rows[0]?.id;
      if (id === undefined) return yield* fail("viewBySlug", "not-found");
      return yield* view(id, userId);
    });

    const listMine = Effect.fn("Workspaces.listMine")(function* (userId: string) {
      const rows = yield* store.db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          createdBy: workspaces.createdBy,
          createdAt: workspaces.createdAt,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(eq(memberships.userId, userId))
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ ...Workspace.fields, role: Role })),
            ),
          ),
          storage("listMine"),
        );

      return rows;
    });

    const role = Effect.fn("Workspaces.role")(function* (workspaceId: string, userId: string) {
      return yield* roleOf("role", workspaceId, userId).pipe(storage("role"));
    });

    const view = Effect.fn("Workspaces.view")(function* (workspaceId: string, userId: string) {
      const role = yield* roleOf("view", workspaceId, userId).pipe(storage("view"));
      const row = yield* workspace("view", workspaceId).pipe(storage("view"));
      const memberRows = yield* members(workspaceId).pipe(storage("view"));

      const installationRows = yield* store.db
        .select()
        .from(installations)
        .where(eq(installations.workspaceId, workspaceId))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InstallationRow))),
          storage("view"),
        );
      const scopeRows = yield* store.db
        .select()
        .from(scopes)
        .where(eq(scopes.workspaceId, workspaceId))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ScopeRow))), storage("view"));

      const inviteRows =
        role === "admin"
          ? yield* store.db
              .select()
              .from(invites)
              .where(eq(invites.workspaceId, workspaceId))
              .pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InviteRow))),
                storage("view"),
              )
          : [];

      return WorkspaceView.make({
        workspace: Workspace.make(row),
        role,
        members: memberRows.map((m) =>
          Membership.make({
            workspaceId: m.workspaceId,
            userId: m.userId,
            role: m.role,
            provenance: m.provenance,
          }),
        ),
        installations: yield* Schema.decodeUnknownEffect(Schema.Array(Installation))(
          installationRows,
        ).pipe(storage("view")),
        scopes: yield* Schema.decodeUnknownEffect(Schema.Array(WorkspaceScope))(scopeRows).pipe(
          storage("view"),
        ),
        invites: inviteRows.map((i) =>
          Invite.make({
            id: i.id,
            workspaceId: i.workspaceId,
            role: i.role,
            invitedBy: i.invitedBy,
            createdAt: i.createdAt,
            expiresAt: i.expiresAt,
            acceptedBy: i.acceptedBy,
            acceptedAt: i.acceptedAt,
            revokedAt: i.revokedAt,
          }),
        ),
      });
    });

    const lastAdminGuard = (operation: string, workspaceId: string, userId: string) =>
      members(workspaceId).pipe(
        Effect.flatMap((rows) => {
          const admins = rows.filter((m) => m.role === "admin");

          return admins.length === 1 && admins[0]?.userId === userId
            ? Effect.fail(fail(operation, "last-admin"))
            : Effect.void;
        }),
      );

    const setRole = Effect.fn("Workspaces.setRole")(function* (
      workspaceId: string,
      actorId: string,
      userId: string,
      value: Role,
    ) {
      const role = yield* decodeInput(Role, value, "setRole");

      yield* requireAdmin("setRole", workspaceId, actorId).pipe(storage("setRole"));

      yield* roleOf("setRole", workspaceId, userId).pipe(
        Effect.mapError(() => fail("setRole", "not-found")),
      );

      if (role === "member")
        yield* lastAdminGuard("setRole", workspaceId, userId).pipe(storage("setRole"));

      yield* store.db
        .update(memberships)
        .set({ role })
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(storage("setRole"));
    });

    const removeMember = Effect.fn("Workspaces.removeMember")(function* (
      workspaceId: string,
      actorId: string,
      userId: string,
    ) {
      yield* requireAdmin("removeMember", workspaceId, actorId).pipe(storage("removeMember"));
      yield* lastAdminGuard("removeMember", workspaceId, userId).pipe(storage("removeMember"));

      yield* store.db
        .delete(memberships)
        .where(eq(memberships.key, key(workspaceId, userId)))
        .pipe(storage("removeMember"));
    });

    const createInvite = Effect.fn("Workspaces.createInvite")(function* (
      workspaceId: string,
      actorId: string,
      value: Role,
      now: number,
    ) {
      const role = yield* decodeInput(Role, value, "createInvite");

      yield* requireAdmin("createInvite", workspaceId, actorId).pipe(storage("createInvite"));
      const id = yield* uuid;
      // Two UUIDs' worth of randomness, hex, as the bearer token shown once to the admin.
      const token = `${yield* uuid}${yield* uuid}`.replace(/-/g, "");
      const hash = yield* tokenHash(token);

      const invite = Invite.make({
        id,
        workspaceId,
        role,
        invitedBy: actorId,
        createdAt: now,
        expiresAt: now + inviteLifetimeMs,
        acceptedBy: null,
        acceptedAt: null,
        revokedAt: null,
      });

      yield* store
        .batch([
          sql`INSERT INTO workspace_invites (id, workspaceId, tokenHash, role, invitedBy, createdAt, expiresAt)
          VALUES (${id}, ${workspaceId}, ${hash}, ${role}, ${actorId}, ${now}, ${invite.expiresAt})`,
        ])
        .pipe(storage("createInvite"));

      return { invite, token };
    });

    const revokeInvite = Effect.fn("Workspaces.revokeInvite")(function* (
      workspaceId: string,
      actorId: string,
      inviteId: string,
      now: number,
    ) {
      yield* requireAdmin("revokeInvite", workspaceId, actorId).pipe(storage("revokeInvite"));

      yield* store.db
        .update(invites)
        .set({ revokedAt: now })
        .where(and(eq(invites.id, inviteId), eq(invites.workspaceId, workspaceId)))
        .pipe(storage("revokeInvite"));
    });

    const acceptInvite = Effect.fn("Workspaces.acceptInvite")(function* (
      value: string,
      userId: string,
      now: number,
    ) {
      const token = yield* decodeInput(
        Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
        value,
        "acceptInvite",
      );

      const hash = yield* tokenHash(token);

      const rows = yield* store.db
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, hash))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InviteRow))),
          storage("acceptInvite"),
        );
      const invite = rows[0];
      if (invite === undefined) return yield* fail("acceptInvite", "not-found");

      if (invite.revokedAt !== null || invite.acceptedAt !== null || invite.expiresAt < now)
        return yield* fail("acceptInvite", "expired");

      const row = yield* workspace("acceptInvite", invite.workspaceId).pipe(
        storage("acceptInvite"),
      );

      // One transaction: the claim on the invite decides, so of two concurrent accepts only the
      // one whose update landed gains a membership.
      yield* store
        .batch([
          sql`UPDATE workspace_invites SET acceptedBy = ${userId}, acceptedAt = ${now}
          WHERE id = ${invite.id} AND acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt >= ${now}`,
          sql`INSERT INTO workspace_memberships (key, workspaceId, userId, role, provenance)
          SELECT ${key(invite.workspaceId, userId)}, ${invite.workspaceId}, ${userId}, ${invite.role}, 'invite'
          WHERE EXISTS (SELECT 1 FROM workspace_invites
            WHERE id = ${invite.id} AND acceptedBy = ${userId} AND acceptedAt = ${now})
          ON CONFLICT DO NOTHING`,
        ])
        .pipe(storage("acceptInvite"));

      const claimed = yield* store.db
        .select()
        .from(invites)
        .where(eq(invites.id, invite.id))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InviteRow))),
          storage("acceptInvite"),
        );

      if (claimed[0]?.acceptedBy !== userId || claimed[0]?.acceptedAt !== now)
        return yield* fail("acceptInvite", "expired");

      return Workspace.make(row);
    });

    const beginInstall = Effect.fn("Workspaces.beginInstall")(function* (
      workspaceId: string,
      actorId: string,
      platform: Platform,
      now: number,
    ) {
      yield* requireAdmin("beginInstall", workspaceId, actorId).pipe(storage("beginInstall"));
      const nonce = yield* crypto.randomUUIDv4().pipe(storage("beginInstall"));

      yield* store
        .batch([
          sql`INSERT INTO workspace_install_intents (nonce, workspaceId, userId, platform, createdAt, expiresAt)
          VALUES (${nonce}, ${workspaceId}, ${actorId}, ${platform}, ${now}, ${now + installIntentLifetimeMs})`,
        ])
        .pipe(storage("beginInstall"));

      return InstallIntent.make({ nonce, workspaceId, userId: actorId, platform });
    });

    const takeInstallIntent = Effect.fn("Workspaces.takeInstallIntent")(function* (
      nonce: string,
      now: number,
    ) {
      const rows = yield* store.db
        .select()
        .from(installIntents)
        .where(eq(installIntents.nonce, nonce))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(IntentRow))),
          storage("takeInstallIntent"),
        );
      const row = rows[0];
      if (!row) return yield* fail("takeInstallIntent", "not-found");

      // Single use: gone whether or not it was still valid.
      yield* store.db
        .delete(installIntents)
        .where(eq(installIntents.nonce, nonce))
        .pipe(storage("takeInstallIntent"));

      if (row.expiresAt < now) return yield* fail("takeInstallIntent", "expired");

      return yield* decodeInput(
        InstallIntent,
        { nonce, workspaceId: row.workspaceId, userId: row.userId, platform: row.platform },
        "takeInstallIntent",
      );
    });

    const install = Effect.fn("Workspaces.install")(function* (
      intent: InstallIntent,
      installed: {
        readonly installationId: string;
        readonly label: string;
        readonly credential: Schema.Json;
      },
      now: number,
    ) {
      const installationKey = key(intent.platform, installed.installationId);

      const existing = yield* store.db
        .select()
        .from(installations)
        .where(eq(installations.key, installationKey))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InstallationRow))),
          storage("install"),
        );
      // An installation belongs to one workspace. Another workspace's admin cannot take it over;
      // moving it starts with uninstalling it there.
      const previous = existing[0]?.workspaceId;

      if (previous !== undefined && previous !== intent.workspaceId)
        return yield* fail("install", "installed-elsewhere");

      const credential = yield* Schema.encodeEffect(credentialJson)(installed.credential).pipe(
        Effect.flatMap((json) => sealed.seal(json)),
        Effect.mapError(() => fail("install", "invalid-input")),
      );

      yield* store
        .batch([
          sql`INSERT INTO workspace_installations (key, workspaceId, platform, installationId, label, installedBy, installedAt, credential)
          VALUES (${installationKey}, ${intent.workspaceId}, ${intent.platform}, ${installed.installationId}, ${installed.label}, ${intent.userId}, ${now}, ${credential})
          ON CONFLICT(key) DO UPDATE SET workspaceId = excluded.workspaceId, label = excluded.label, installedBy = excluded.installedBy, installedAt = excluded.installedAt, credential = excluded.credential`,
        ])
        .pipe(storage("install"));

      const rows = yield* store.db
        .select()
        .from(installations)
        .where(eq(installations.key, installationKey))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Installation))),
          storage("install"),
        );
      const row = rows[0];
      if (!row) return yield* fail("install", "storage");
      return row;
    });

    const uninstall = Effect.fn("Workspaces.uninstall")(function* (
      workspaceId: string,
      actorId: string,
      ref: { readonly platform: Platform; readonly installationId: string },
    ) {
      yield* requireAdmin("uninstall", workspaceId, actorId).pipe(storage("uninstall"));
      const installationKey = key(ref.platform, ref.installationId);
      yield* store
        .batch([
          sql`DELETE FROM workspace_scopes WHERE workspaceId = ${workspaceId}
          AND platform = ${ref.platform} AND installationId = ${ref.installationId}`,
          sql`DELETE FROM workspace_installations WHERE key = ${installationKey} AND workspaceId = ${workspaceId}`,
        ])
        .pipe(storage("uninstall"));
    });

    /** The installation must be the workspace's own: a scope of somebody else's team is never coverable. */
    const installedHere = (operation: string, workspaceId: string, source: ScopeInput) =>
      store.db
        .select()
        .from(installations)
        .where(eq(installations.key, key(source.platform, source.installationId)))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(InstallationRow))),
          storage(operation),
          Effect.flatMap((rows) =>
            rows[0]?.workspaceId === workspaceId
              ? Effect.void
              : Effect.fail(fail(operation, "not-installed")),
          ),
        );

    const addScope = Effect.fn("Workspaces.addScope")(function* (
      workspaceId: string,
      actorId: string,
      value: ScopeInput,
    ) {
      const source = yield* decodeInput(ScopeInput, value, "addScope");

      yield* requireAdmin("addScope", workspaceId, actorId).pipe(storage("addScope"));
      yield* installedHere("addScope", workspaceId, source);

      yield* store
        .batch([
          sql`INSERT INTO workspace_scopes (key, workspaceId, platform, installationId, scope, label)
          VALUES (${key(workspaceId, source.platform, source.installationId, source.scope)}, ${workspaceId}, ${source.platform}, ${source.installationId}, ${source.scope}, ${source.label ?? source.scope})
          ON CONFLICT DO NOTHING`,
        ])
        .pipe(storage("addScope"));
    });

    const removeScope = Effect.fn("Workspaces.removeScope")(function* (
      workspaceId: string,
      actorId: string,
      value: ScopeInput,
    ) {
      const source = yield* decodeInput(ScopeInput, value, "removeScope");
      yield* requireAdmin("removeScope", workspaceId, actorId).pipe(storage("removeScope"));

      yield* store.db
        .delete(scopes)
        .where(
          eq(scopes.key, key(workspaceId, source.platform, source.installationId, source.scope)),
        )
        .pipe(storage("removeScope"));
    });

    return Service.of({
      create,
      update,
      viewBySlug,
      listMine,
      view,
      role,
      setRole,
      removeMember,
      createInvite,
      revokeInvite,
      acceptInvite,
      beginInstall,
      takeInstallIntent,
      install,
      uninstall,
      addScope,
      removeScope,
    });
  }),
);
export const layer = layerNoDeps;
export * as Workspaces from "./workspaces";
