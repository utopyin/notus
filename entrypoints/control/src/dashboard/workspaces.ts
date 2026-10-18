import { Identities } from "@notus/accounts/identities";
import { PLATFORM_DESCRIPTORS } from "@notus/platform/descriptors/index";
import { InstallationId } from "@notus/platform/ids";
import type { Platform } from "@notus/platform/platform";
import { Platforms } from "@notus/platforms/registry";
import type { WorkspaceView } from "@notus/workspaces/types";
import { Workspaces } from "@notus/workspaces/workspaces";
import * as Effect from "effect/Effect";
import { dashboardConfig } from "../config";
import * as Install from "../install";
import { Viewer, WorkspaceRpcs } from "./rpcs";
import type { WorkspacePage } from "./types";
import { refusal, refuse } from "./viewers";

/** A workspace, its members and invites, and the platforms it installed and covers. */
export const layer = WorkspaceRpcs.toLayer(
  Effect.gen(function* () {
    const dashboard = yield* dashboardConfig;
    const workspaces = yield* Workspaces.Service;
    const identities = yield* Identities.Service;
    const platforms = yield* Platforms.Service;

    const installable: ReadonlyArray<Platform> = [
      ...(dashboard.slack ? (["slack"] as const) : []),
      ...(dashboard.githubAppSlug ? (["github"] as const) : []),
    ];

    /** Member rows carry the display profile of their user, when one has signed in. */
    const page = (view: WorkspaceView) =>
      identities.profiles(view.members.map((m) => m.userId)).pipe(
        Effect.map((profiles): WorkspacePage => ({
          workspace: view.workspace,
          role: view.role,
          installations: view.installations.map((i) => ({
            workspaceId: i.workspaceId,
            platform: i.platform,
            installationId: i.installationId,
            label: i.label,
            installedBy: i.installedBy,
            installedAt: i.installedAt,
            name: PLATFORM_DESCRIPTORS[i.platform].name,
            icon: PLATFORM_DESCRIPTORS[i.platform].icon,
            scopeNoun: PLATFORM_DESCRIPTORS[i.platform].scopeNoun,
          })),
          installable,
          scopes: view.scopes,
          invites: view.invites,
          members: view.members.map((member) => {
            const profile = profiles.get(member.userId);

            return {
              ...member,
              name: profile?.name ?? null,
              email: profile?.email ?? null,
              image: profile?.image ?? null,
            };
          }),
        })),
      );

    /** Runs as the viewer, every refusal turned into the dashboard's. */
    const asViewer = <A, E extends { readonly _tag: string }, R>(
      run: (me: Viewer["Service"]) => Effect.Effect<A, E, R>,
    ) => refuse(Effect.flatMap(Viewer, run));

    return {
      createWorkspace: ({ name, slug }) =>
        asViewer((me) => workspaces.create(me.userId, { name, slug }, me.now)),
      updateWorkspace: ({ workspaceId, name, slug }) =>
        asViewer((me) => workspaces.update(workspaceId, me.userId, { name, slug })),
      workspace: ({ workspaceId }) =>
        asViewer((me) => workspaces.view(workspaceId, me.userId).pipe(Effect.flatMap(page))),
      workspaceBySlug: ({ slug }) =>
        asViewer((me) => workspaces.viewBySlug(slug, me.userId).pipe(Effect.flatMap(page))),
      setRole: ({ workspaceId, userId, role }) =>
        asViewer((me) => workspaces.setRole(workspaceId, me.userId, userId, role)),
      removeMember: ({ workspaceId, userId }) =>
        asViewer((me) => workspaces.removeMember(workspaceId, me.userId, userId)),
      createInvite: ({ workspaceId, role }) =>
        asViewer((me) => workspaces.createInvite(workspaceId, me.userId, role, me.now)),
      revokeInvite: ({ workspaceId, inviteId }) =>
        asViewer((me) => workspaces.revokeInvite(workspaceId, me.userId, inviteId, me.now)),
      acceptInvite: ({ token }) =>
        asViewer((me) => workspaces.acceptInvite(token, me.userId, me.now)),
      installUrl: ({ workspaceId, platform }) =>
        asViewer((me) =>
          Effect.gen(function* () {
            if (!dashboard.origin) return yield* refusal("unconfigured");

            const intent = yield* workspaces.beginInstall(workspaceId, me.userId, platform, me.now);
            const scope = yield* platforms.forPlatform(platform);

            return yield* scope.installing.begin({
              state: intent.nonce,
              redirectUri: Install.redirectUriOf(dashboard.origin, platform),
              userId: me.userId,
            });
          }),
        ).pipe(Effect.map(({ url }) => ({ url }))),
      /** Only the user who began the install completes it. */
      completeInstall: ({ platform, search }) =>
        asViewer((me) =>
          dashboard.origin
            ? Install.complete(dashboard.origin, me.userId, platform, search).pipe(
                Effect.map((location) => ({ location })),
              )
            : refusal("unconfigured"),
        ),
      uninstall: ({ workspaceId, platform, installationId }) =>
        asViewer((me) =>
          workspaces.uninstall(workspaceId, me.userId, { platform, installationId }),
        ),
      addScope: ({ workspaceId, source }) =>
        asViewer((me) => workspaces.addScope(workspaceId, me.userId, source)),
      removeScope: ({ workspaceId, source }) =>
        asViewer((me) => workspaces.removeScope(workspaceId, me.userId, source)),
      listScopes: ({ workspaceId, platform, installationId }) =>
        asViewer((me) =>
          Effect.gen(function* () {
            const view = yield* workspaces.view(workspaceId, me.userId);
            const ref = { platform, installationId: InstallationId.make(installationId) };

            if (
              !view.installations.some(
                (i) => i.platform === ref.platform && i.installationId === ref.installationId,
              )
            )
              return yield* refusal("not-installed");

            const port = yield* platforms.forInstallation(ref);
            const scopes = yield* port.scopes.list;

            return {
              scopes: scopes.map((scope) => ({
                id: scope.id,
                label: scope.label,
                member: scope.member,
                private: scope.private,
              })),
            };
          }),
        ),
    };
  }),
);
