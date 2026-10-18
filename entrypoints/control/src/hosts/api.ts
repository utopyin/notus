import { Identities } from "@notus/accounts/identities";
import type { Profile } from "@notus/accounts/types";
import { descriptorOf } from "@notus/compute/descriptors/index";
import type { Provider as ComputeProvider } from "@notus/compute/provider";
import type { Provider } from "@notus/openai/types";
import { PLATFORM_DESCRIPTORS } from "@notus/platform/descriptors/index";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import { InstallError } from "@notus/platform/installing";
import { Platform } from "@notus/platform/platform";
import type { Actor } from "@notus/platform/source";
import { Platforms } from "@notus/platforms/registry";
import { Compute } from "@notus/workspaces/compute";
import { Credentials } from "@notus/workspaces/credentials";
import { Environments } from "@notus/workspaces/environments";
import { Roles } from "@notus/workspaces/roles";
import { Templates } from "@notus/workspaces/templates";
import type { Role, WorkspaceView } from "@notus/workspaces/types";
import { Workspaces, type ScopeInput } from "@notus/workspaces/workspaces";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { configurationOf, offered } from "../compute";
import type { DashboardConfig, DeploymentConfig, GithubConfig, RuntimeConfig } from "../config";
import { cryptoLayer } from "../crypto";
import { authentication as runtimeAuthentication } from "../devbox";
import { Inbox } from "../inbox";
import * as Ingress from "../ingress";
import * as Install from "../install";
import { platformsLayer } from "../platforms";
import * as Auth from "../runtime/auth";
import * as Callback from "../runtime/callback";
import { BuildHost } from "./build";
import { ConnectionHost } from "./connection";
import { Sessions } from "./sessions";
import { TaskHost } from "./task";

/** What the API Worker reads from deployment configuration, once, during construction. */
export interface Settings {
  readonly deployment: DeploymentConfig;
  readonly runtime: RuntimeConfig | null;
  readonly github: GithubConfig | null;
  readonly webhookSecret: Redacted.Redacted<string> | null;
  readonly dashboard: DashboardConfig;
  readonly providers: ReadonlyArray<ComputeProvider>;
}

/** Work that outlives the request that started it; the app runs it on the platform's lifetime. */
export class Background extends Context.Service<
  Background,
  {
    readonly run: (
      effect: Effect.Effect<void, never, RuntimeContext>,
    ) => Effect.Effect<void, never, RuntimeContext>;
  }
>()("@notus/control/hosts/Api/Background") {}

/**
 * The API Worker: platform ingress, the dev box callback, platform installs, the inbox drain and
 * the dashboard's binding RPC. Every dashboard call resolves its user from the forwarded cookie.
 */
const make = (settings: Settings) =>
  Effect.gen(function* () {
    const dashboard = settings.dashboard;
    const computeProviders = settings.providers;
    const registered = offered(computeProviders);
    const sessions = yield* Sessions.Service;
    const background = yield* Background;
    const tasks = yield* TaskHost.Remote;
    const connections = yield* ConnectionHost.Remote;
    const builds = yield* BuildHost.Remote;
    const authentication = yield* Auth.Service;
    const platforms = yield* Platforms.Service;
    const inbox = yield* Inbox.Service;
    const workspaces = yield* Workspaces.Service;
    const roles = yield* Roles.Service;
    const environments = yield* Environments.Service;
    const templates = yield* Templates.Service;
    const accounts = yield* Compute.Service;
    const identities = yield* Identities.Service;

    // A waitUntil pass opens its own scope, so it never retains the request's D1 client.
    const drain = Effect.scoped(
      inbox.drain((command) =>
        Effect.gen(function* () {
          const task = tasks(command.reservation.taskId);
          const result = yield* task.admit(command);

          if (!result.ok) return yield* Effect.fail("task_admission_rejected");

          if (result.needsEnvironment) {
            const environment = yield* environments.get(command.reservation.workspaceId);

            // What the workspace covers now; the task keeps this list and chooses from it.
            const repositories = yield* inbox.repositories(
              command.reservation.workspaceId,
              command.reservation.initiatorId,
            );

            const prepared = yield* task.prepareEnvironment(
              Option.getOrNull(environment),
              repositories,
              yield* roles.resolve(command.reservation.workspaceId),
            );

            if (!prepared.ok) return yield* Effect.fail("task_configuration_rejected");
          }
        }),
      ),
    ).pipe(
      Effect.flatMap((counts) => Effect.logInfo("inbox.drain", counts)),
      Effect.catch(() => Effect.logError("inbox.drain_failed")),
      // Alchemy's cron wrapper catches defects; log before that boundary.
      Effect.tapCause(() => Effect.logError("inbox.drain_defect")),
    );

    const callback = Callback.handler((capability, request) => {
      const task = tasks(capability.bootstrap.taskId);

      switch (request._tag) {
        case "Assignment":
          return task.runtimeAssignment(capability);
        case "Enroll":
          return task.runtimeEnroll(capability, request.request);
        case "Ready":
          return task.runtimeReady(capability, request.request);
        case "Poll":
          return task.runtimePoll(capability, request.request);
        case "Observe":
          return task.runtimeObserve(capability, request.request);
        case "Login":
          return task.runtimeLogin(capability);
      }
    }).pipe(
      Effect.provideService(Auth.Service, authentication),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 })),
    );

    // Ingress dependencies: one tagged failure.
    const failing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError(() => new Ingress.IngressFailure({})));

    const ingressDependencies: Ingress.Dependencies = {
      workspaceOf: (ref) => failing(inbox.workspaceOf(ref)),
      covers: (workspaceId, source) => failing(inbox.covers(workspaceId, source)),
      routeOf: (conversationKey) => failing(inbox.routeOf(conversationKey)),
      admit: (input) =>
        inbox
          .admit(input)
          .pipe(
            Effect.mapError((error) =>
              error._tag === "Control.Unauthorized" ||
              error._tag === "Control.Conflict" ||
              error._tag === "Control.IntakeError"
                ? error
                : new Ingress.IngressFailure({}),
            ),
          ),
      kick: background.run(drain),
    };

    const ingress = {
      slack: Ingress.handler("slack", ingressDependencies).pipe(
        Effect.provideService(Platforms.Service, platforms),
      ),
      github: Ingress.handler("github", ingressDependencies).pipe(
        Effect.provideService(Platforms.Service, platforms),
      ),
    };

    // The platform's redirect after an install; it moves on to the dashboard's origin.
    const install = dashboard.origin
      ? Install.bounce(dashboard.origin)
      : Effect.succeed(HttpServerResponse.empty({ status: 404 }));

    /** Which platforms this deployment can install; the dashboard offers exactly these. */
    const installable: ReadonlyArray<Platform> = [
      ...(dashboard.slack ? (["slack"] as const) : []),
      ...(dashboard.githubAppSlug ? (["github"] as const) : []),
    ];

    /**
     * Resolves the signed-in dashboard user from the forwarded cookie: the Better Auth session,
     * its linked provider accounts as verified identities, and the canonical Notus user those
     * identities adopt. Anonymous requests yield null; nothing here is trusted from the caller.
     */
    const signedIn = (cookie: string) =>
      Effect.gen(function* () {
        const session = yield* sessions.signIn(cookie);
        if (session === null) return null;

        const accounts = session.accounts;
        const actors: Array<Actor> = [];

        for (const account of accounts) {
          if (account.providerId === "slack" && session.user.slackTeamId)
            actors.push({
              platform: "slack",
              installationId: InstallationId.make(session.user.slackTeamId),
              externalId: PlatformId.make(account.accountId),
            });

          if (account.providerId === "github")
            actors.push({
              platform: "github",
              installationId: InstallationId.make("oauth"),
              externalId: PlatformId.make(account.accountId),
            });
        }

        const now = yield* Clock.currentTimeMillis;

        const userId = yield* identities.adopt({
          authUserId: session.user.id,
          actors,
          profile: {
            name: session.user.name,
            email: session.user.email,
            image: session.user.image ?? null,
            githubLogin: session.user.githubLogin ?? null,
          },
          now,
        });

        return { session, accounts, userId, now };
      });

    type SignedIn = NonNullable<Effect.Success<ReturnType<typeof signedIn>>>;

    /** Member rows carry the display profile of their user, when one has signed in. */
    const withProfiles = (view: WorkspaceView) =>
      identities.profiles(view.members.map((m) => m.userId)).pipe(
        Effect.map((profiles) => ({
          workspace: view.workspace,
          role: view.role,
          installations: view.installations.map((i): InstallationSummary => ({
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
          scopes: view.scopes.map((s): ScopeSummaryRow => ({
            workspaceId: s.workspaceId,
            platform: s.platform,
            installationId: s.installationId,
            scope: s.scope,
            label: s.label,
          })),
          invites: view.invites,
          members: view.members.map((member) => {
            const profile = profiles.get(member.userId);

            return {
              workspaceId: member.workspaceId,
              userId: member.userId,
              role: member.role,
              provenance: member.provenance,
              name: profile?.name ?? null,
              email: profile?.email ?? null,
              image: profile?.image ?? null,
            };
          }),
        })),
      );

    /** What the dashboard sees of a scope, an installation and a source: plain strings, no brands crossing the RPC. */
    interface ScopeSummary {
      readonly id: string;
      readonly label: string;
      readonly member: boolean;
      readonly private: boolean;
    }
    interface InstallationSummary {
      readonly workspaceId: string;
      readonly platform: Platform;
      readonly installationId: string;
      readonly label: string;
      readonly installedBy: string;
      readonly installedAt: number;
      /** From the platform's descriptor, so the dashboard never branches on the platform. */
      readonly name: string;
      readonly icon: string;
      readonly scopeNoun: { readonly one: string; readonly many: string };
    }
    interface ScopeSummaryRow {
      readonly workspaceId: string;
      readonly platform: Platform;
      readonly installationId: string;
      readonly scope: string;
      readonly label: string;
    }

    /** One call on the user's Connection object, its refusal turned into a dashboard failure. */
    const connection = <A>(
      userId: string,
      call: (
        object: ConnectionHost.Interface,
      ) => Effect.Effect<
        { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string },
        never,
        RuntimeContext
      >,
    ) =>
      call(connections(userId)).pipe(
        Effect.flatMap((result) =>
          result.ok
            ? Effect.succeed(result.value)
            : Effect.fail<DashboardFailure>({ _tag: "Connection", reason: result.reason }),
        ),
      );

    /** How many of a workspace's latest tasks the list reads, one object call each. */
    const taskListLimit = 50;

    const initiatorOf = (
      profiles: ReadonlyMap<string, Profile>,
      task: { readonly initiatorId: string },
    ) => {
      const profile = profiles.get(task.initiatorId);
      return profile ? { name: profile.name, image: profile.image } : null;
    };

    /** RPC results carry a reason string instead of an error class the dashboard cannot decode. */
    interface DashboardFailure {
      readonly _tag: string;
      readonly reason?: string;
    }

    const dashboardResult = <A>(effect: Effect.Effect<A, DashboardFailure, RuntimeContext>) =>
      effect.pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) =>
          Effect.logWarning(`dashboard.rpc_failed ${error._tag} ${error.reason ?? ""}`).pipe(
            Effect.as({ ok: false as const, reason: error.reason ?? "failed" }),
          ),
        ),
        Effect.orElseSucceed(() => ({ ok: false as const, reason: "failed" })),
      );

    /** The checks of a provider this deployment runs; any other key is refused before storage. */
    const compute = (provider: string) => {
      const configuration = configurationOf(computeProviders, provider);

      return configuration
        ? Effect.succeed(configuration)
        : Effect.fail<DashboardFailure>({
            _tag: "Environment",
            reason: "This deployment runs no such devbox provider.",
          });
    };

    /** The workspace's template build with one provider; null where the provider builds none. */
    const builder = (workspaceId: string, provider: string) => {
      if (!descriptorOf(provider)?.capabilities.has("template:build")) return null;
      const object = builds(`${workspaceId}:${provider}`);

      return {
        status: object.status(),
        start: (actorId: string) =>
          object
            .start(workspaceId, provider, actorId)
            .pipe(
              Effect.flatMap((view) =>
                view === null
                  ? Effect.fail<DashboardFailure>({ _tag: "Template", reason: "invalid-input" })
                  : Effect.succeed(view),
              ),
            ),
      };
    };

    const authorized = <A>(
      cookie: string,
      run: (me: SignedIn) => Effect.Effect<A, DashboardFailure, RuntimeContext>,
    ) =>
      dashboardResult(
        Effect.gen(function* () {
          const me = yield* signedIn(cookie).pipe(
            Effect.mapError((error): DashboardFailure => ({
              _tag: error._tag,
              reason: "unauthorized",
            })),
          );

          if (me === null)
            return yield* Effect.fail<DashboardFailure>({
              _tag: "Anonymous",
              reason: "unauthorized",
            });

          return yield* run(me);
        }),
      );

    const worker = {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://notus.invalid").pathname;

        if (request.method === "GET" && path === "/health") return HttpServerResponse.text("ok");

        // Every platform's deliveries arrive at /<platform>/events.
        const events = /^\/([a-z]+)\/events$/.exec(path)?.[1];

        if (events !== undefined && Schema.is(Platform)(events)) return yield* ingress[events];
        if (path === "/auth" || path.startsWith("/auth/")) return yield* sessions.fetch;
        if (/^\/platforms\/[a-z]+\/install$/.test(path)) return yield* install;
        if (path.startsWith("/runtime/")) return yield* callback;
        return HttpServerResponse.empty({ status: 404 });
      }),
      // Binding RPC only. No fetch route exposes task state or seed authority.
      snapshot: (taskId: string) => tasks(taskId).snapshot(),
      /**
       * The signed-in dashboard user, resolved from the cookie header the dashboard forwards.
       * Anonymous requests get null. Nothing here is a secret: linked providers by name and
       * account subject, sessions without tokens, and workspace membership.
       */
      dashboardMe: (cookie: string) =>
        signedIn(cookie).pipe(
          Effect.flatMap((me) =>
            me === null
              ? Effect.succeed(null)
              : workspaces.listMine(me.userId).pipe(
                  Effect.map((mine) => ({
                    user: {
                      id: me.userId,
                      name: me.session.user.name,
                      email: me.session.user.email,
                      image: me.session.user.image ?? null,
                      slackTeamId: me.session.user.slackTeamId ?? null,
                    },
                    accounts: me.accounts.map((account) => ({
                      id: account.id,
                      provider: account.providerId,
                      accountId: account.accountId,
                      createdAt: account.createdAt.toISOString(),
                    })),
                    workspaces: mine.map((w) => ({
                      id: w.id,
                      name: w.name,
                      slug: w.slug,
                      role: w.role,
                    })),
                  })),
                ),
          ),
          Effect.tapError((error) => Effect.logWarning(`dashboard.me_failed ${error._tag}`)),
          Effect.orElseSucceed(() => null),
        ),
      /** The signed-in user's sessions, never their tokens: revocation goes by ID. */
      dashboardSessions: (cookie: string) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const listed = yield* sessions.list(cookie);

            return listed
              .map((session) => ({
                id: session.id,
                createdAt: session.createdAt.toISOString(),
                userAgent: session.userAgent,
                current: session.id === me.session.sessionId,
              }))
              .sort((a, b) =>
                a.current ? -1 : b.current ? 1 : b.createdAt.localeCompare(a.createdAt),
              );
          }),
        ),
      /** Revokes one of the signed-in user's own sessions; the token never leaves this Worker. */
      dashboardRevokeSession: (cookie: string, sessionId: string) =>
        authorized(cookie, () =>
          Effect.gen(function* () {
            const revoked = yield* sessions.revoke(cookie, sessionId);

            if (!revoked)
              return yield* Effect.fail<DashboardFailure>({ _tag: "Session", reason: "not-found" });
          }),
        ),
      dashboardCreateWorkspace: (cookie: string, name: string, slug?: string) =>
        authorized(cookie, (me) => workspaces.create(me.userId, { name, slug }, me.now)),
      dashboardUpdateWorkspace: (
        cookie: string,
        workspaceId: string,
        input: { readonly name?: string; readonly slug?: string },
      ) => authorized(cookie, (me) => workspaces.update(workspaceId, me.userId, input)),
      dashboardWorkspace: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          workspaces.view(workspaceId, me.userId).pipe(Effect.flatMap(withProfiles)),
        ),
      dashboardWorkspaceBySlug: (cookie: string, slug: string) =>
        authorized(cookie, (me) =>
          workspaces.viewBySlug(slug, me.userId).pipe(Effect.flatMap(withProfiles)),
        ),
      dashboardSetRole: (cookie: string, workspaceId: string, userId: string, role: Role) =>
        authorized(cookie, (me) => workspaces.setRole(workspaceId, me.userId, userId, role)),
      dashboardRemoveMember: (cookie: string, workspaceId: string, userId: string) =>
        authorized(cookie, (me) => workspaces.removeMember(workspaceId, me.userId, userId)),
      dashboardCreateInvite: (cookie: string, workspaceId: string, role: Role) =>
        authorized(cookie, (me) => workspaces.createInvite(workspaceId, me.userId, role, me.now)),
      dashboardRevokeInvite: (cookie: string, workspaceId: string, inviteId: string) =>
        authorized(cookie, (me) =>
          workspaces.revokeInvite(workspaceId, me.userId, inviteId, me.now),
        ),
      dashboardAcceptInvite: (cookie: string, token: string) =>
        authorized(cookie, (me) => workspaces.acceptInvite(token, me.userId, me.now)),
      /** Where to send an admin to install a platform for the workspace; the intent outlives the round trip. */
      dashboardInstallUrl: (cookie: string, workspaceId: string, platform: Platform) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            if (!dashboard.origin)
              return yield* Effect.fail<DashboardFailure>({
                _tag: "Unconfigured",
                reason: "unconfigured",
              });

            const intent = yield* workspaces.beginInstall(workspaceId, me.userId, platform, me.now);
            const scope = yield* platforms.forPlatform(platform);
            const { url } = yield* scope.installing.begin({
              state: intent.nonce,
              redirectUri: Install.redirectUriOf(dashboard.origin, platform),
              userId: me.userId,
            });

            return { url };
          }),
        ),
      /**
       * The platform's redirect, bounced to the dashboard so it arrives with the session cookie:
       * only the user who began the install completes it. Answers where to send the browser.
       */
      dashboardCompleteInstall: (cookie: string, platform: string, search: string) =>
        authorized(cookie, (me) =>
          dashboard.origin
            ? Install.complete(dashboard.origin, me.userId, platform, search).pipe(
                Effect.provideService(Platforms.Service, platforms),
                Effect.provideService(Workspaces.Service, workspaces),
                Effect.map((location) => ({ location })),
              )
            : Effect.fail<DashboardFailure>({ _tag: "Unconfigured", reason: "unconfigured" }),
        ),
      dashboardUninstall: (
        cookie: string,
        workspaceId: string,
        platform: Platform,
        installationId: string,
      ) =>
        authorized(cookie, (me) =>
          workspaces.uninstall(workspaceId, me.userId, { platform, installationId }),
        ),
      dashboardAddScope: (cookie: string, workspaceId: string, source: ScopeInput) =>
        authorized(cookie, (me) => workspaces.addScope(workspaceId, me.userId, source)),
      dashboardRemoveScope: (cookie: string, workspaceId: string, source: ScopeInput) =>
        authorized(cookie, (me) => workspaces.removeScope(workspaceId, me.userId, source)),
      /**
       * The scopes an installation can see (channels of a team, later repositories of an App), for
       * admins choosing what a workspace covers. Only the workspace that installed it may ask.
       */
      dashboardListScopes: (
        cookie: string,
        workspaceId: string,
        platform: Platform,
        installationId: string,
      ) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const view = yield* workspaces.view(workspaceId, me.userId);
            const ref = { platform, installationId: InstallationId.make(installationId) };

            if (
              !view.installations.some(
                (i) => i.platform === ref.platform && i.installationId === ref.installationId,
              )
            )
              return yield* Effect.fail<DashboardFailure>({
                _tag: "NotInstalled",
                reason: "not-installed",
              });

            const port = yield* platforms.forInstallation(ref);
            const scopes = yield* port.scopes.list;

            return {
              scopes: scopes.map((scope): ScopeSummary => ({
                id: scope.id,
                label: scope.label,
                member: scope.member,
                private: scope.private,
              })),
            };
          }),
        ),
      /**
       * The workspace's tasks, newest first, each read from its own object so the row is as live
       * as the task. Members see every task of the workspace.
       */
      dashboardTasks: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            yield* workspaces.role(workspaceId, me.userId);

            const refs = yield* inbox
              .tasks(workspaceId, taskListLimit)
              .pipe(Effect.mapError((): DashboardFailure => ({ _tag: "Tasks", reason: "failed" })));

            const rows = yield* Effect.forEach(
              refs,
              (ref) =>
                tasks(ref.taskId)
                  .summary()
                  .pipe(Effect.orElseSucceed(() => null)),
              { concurrency: 8 },
            );
            const listed = rows.filter(
              (row): row is NonNullable<typeof row> =>
                row !== null && row.workspaceId === workspaceId,
            );

            const profiles = yield* identities.profiles([
              ...new Set(listed.map((row) => row.initiatorId)),
            ]);

            return listed.map((row) => ({ ...row, initiator: initiatorOf(profiles, row) }));
          }),
        ),
      /** One task with its whole timeline, for a member of the workspace it belongs to. */
      dashboardTask: (cookie: string, workspaceId: string, taskId: string) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            yield* workspaces.role(workspaceId, me.userId);

            // Only tasks routed in this workspace are opened, so no object is created for a guess.
            const owned = yield* inbox
              .owns(workspaceId, taskId)
              .pipe(Effect.mapError((): DashboardFailure => ({ _tag: "Tasks", reason: "failed" })));
            const detail = owned ? yield* tasks(taskId).view() : null;

            if (detail === null || detail.workspaceId !== workspaceId)
              return yield* Effect.fail<DashboardFailure>({ _tag: "Task", reason: "not-found" });

            const profiles = yield* identities.profiles([detail.initiatorId]);

            return { ...detail, initiator: initiatorOf(profiles, detail) };
          }),
        ),
      // Status only: no method here returns provider tokens.
      connectionStatus: (userId: string) => connections(userId).status(userId),
      revokeConnection: (userId: string, provider: Provider) =>
        connections(userId).revoke(userId, provider),
      /** The signed-in user's model connections: status projections, never material. */
      /** The workspace's specialist roles: current text and revision each. */
      dashboardRoles: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) => roles.list(workspaceId, me.userId)),
      dashboardRoleHistory: (cookie: string, workspaceId: string, name: string) =>
        authorized(cookie, (me) => roles.history(workspaceId, me.userId, name)),
      dashboardSaveRole: (
        cookie: string,
        workspaceId: string,
        name: string,
        summary: string,
        body: string,
      ) =>
        authorized(cookie, (me) => roles.save(workspaceId, me.userId, name, summary, body, me.now)),
      dashboardDeleteRole: (cookie: string, workspaceId: string, name: string) =>
        authorized(cookie, (me) => roles.remove(workspaceId, me.userId, name)),
      /**
       * The workspace's devbox configuration, the templates its admins added and the provider
       * accounts it connected. Connections are status only: who connected which provider, when.
       */
      dashboardEnvironment: (cookie: string, workspaceId: string, requested: string | null) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const environment = yield* environments.view(workspaceId, me.userId);

            // The page asked for one, or shows the provider the workspace runs on, or the first.
            const provider =
              requested ?? Option.getOrUndefined(environment)?.provider ?? registered[0] ?? "";

            const configuration = yield* compute(provider);
            const own = yield* templates.list(workspaceId, me.userId);
            const mine = own.filter((template) => template.provider === provider);

            return {
              provider,
              /** Every provider this deployment runs; the page offers a choice when there are several. */
              providers: registered,
              environment: Option.getOrNull(environment),
              approvedImages: mine.map((template) => template.ref),
              workspaceImages: own,
              /** The template a configuration that selects none starts from, saved or inferred. */
              defaultImage: configuration.defaultOf({
                refs: mine.map((template) => template.ref),
                default: mine.find((template) => template.isDefault)?.ref ?? null,
              }),
              connection:
                (yield* accounts.list(workspaceId, me.userId)).find(
                  (connection) => connection.provider === provider,
                ) ?? null,
              /** The last build of the Notus template, where the provider builds one. */
              build: yield* builder(workspaceId, provider)?.status ?? Effect.succeed(null),
            };
          }),
        ),
      dashboardEnvironmentHistory: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) => environments.history(workspaceId, me.userId)),
      /** The provider's policy decides before anything is stored; its message is what the page shows. */
      dashboardSaveEnvironment: (
        cookie: string,
        workspaceId: string,
        provider: string,
        config: Schema.Json,
      ) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const configuration = yield* compute(provider);
            const own = yield* templates.approved(workspaceId, provider);
            yield* configuration.validate(config, own).pipe(
              Effect.mapError((error): DashboardFailure => ({
                _tag: error._tag,
                reason: error.message,
              })),
            );

            return yield* environments.save(workspaceId, me.userId, provider, config, me.now);
          }),
        ),
      /**
       * An admin vouches for a template of their own, such as an image they built from the Notus
       * base and published where the provider can pull it. Nothing here inspects it.
       */
      dashboardAddImage: (
        cookie: string,
        workspaceId: string,
        provider: string,
        ref: string,
        label: string,
      ) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const configuration = yield* compute(provider);
            const value = yield* configuration.validateTemplate(ref).pipe(
              Effect.mapError((error): DashboardFailure => ({
                _tag: "Template",
                reason: error.message,
              })),
            );

            return yield* templates.add(
              workspaceId,
              me.userId,
              provider,
              value,
              label.trim(),
              me.now,
            );
          }),
        ),
      /** A stored configuration that selected it keeps it, shown as no longer approved. */
      dashboardRemoveImage: (cookie: string, workspaceId: string, provider: string, ref: string) =>
        authorized(cookie, (me) => templates.remove(workspaceId, me.userId, provider, ref)),
      /** Null clears the default; a launch then needs a configuration that selects a template. */
      dashboardSetDefaultImage: (
        cookie: string,
        workspaceId: string,
        provider: string,
        ref: string | null,
      ) => authorized(cookie, (me) => templates.setDefault(workspaceId, me.userId, provider, ref)),
      /**
       * An admin connects the workspace's own provider account. The adapter checks its shape; the
       * credential is sealed on write and no response ever carries it back.
       */
      dashboardConnectCompute: (
        cookie: string,
        workspaceId: string,
        provider: string,
        credential: Schema.Json,
        label: string,
      ) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const configuration = yield* compute(provider);
            const normalized = yield* configuration.validateConnection(credential).pipe(
              Effect.mapError((error): DashboardFailure => ({
                _tag: "Connection",
                reason: error.message,
              })),
            );

            const connected = yield* accounts.connect(
              workspaceId,
              me.userId,
              provider,
              label.trim(),
              normalized,
              me.now,
            );

            // A newly connected account holds none of the old one's snapshots, so every connect
            // builds the Notus template afresh where the provider builds one.
            // The account is connected either way; an admin can start a build that failed to.
            const build = builder(workspaceId, provider);

            if (build !== null)
              yield* build.start(me.userId).pipe(
                Effect.tapError((error) =>
                  Effect.logWarning(`dashboard.build_start_failed ${error.reason ?? ""}`),
                ),
                Effect.ignore,
              );

            return connected.find((connection) => connection.provider === provider) ?? null;
          }),
        ),
      /**
       * An admin builds the Notus template again in the workspace's own account, such as after a
       * failed build; a build already running is reported instead of started twice.
       */
      dashboardBuildTemplate: (cookie: string, workspaceId: string, provider: string) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            yield* compute(provider);
            const build = builder(workspaceId, provider);

            if (build === null)
              return yield* Effect.fail<DashboardFailure>({
                _tag: "Template",
                reason: "This provider builds no template; add one of your own.",
              });

            yield* accounts.authorizeBuild(workspaceId, me.userId, provider);

            return yield* build.start(me.userId);
          }),
        ),
      /** Boxes already running are not ended, but Notus reaches none of them until it is connected again. */
      dashboardDisconnectCompute: (cookie: string, workspaceId: string, provider: string) =>
        authorized(cookie, (me) =>
          accounts.disconnect(workspaceId, me.userId, provider).pipe(Effect.as(null)),
        ),
      dashboardConnections: (cookie: string) =>
        authorized(cookie, (me) => connection(me.userId, (c) => c.status(me.userId))),
      /** Starts "Sign in with ChatGPT" by device code; the page shows the code and the link. */
      dashboardBeginChatGpt: (cookie: string) =>
        authorized(cookie, (me) => connection(me.userId, (c) => c.beginDeviceLogin(me.userId))),
      /** One poll of the issuer; links the login once the person finished on the verification page. */
      dashboardPollChatGpt: (cookie: string) =>
        authorized(cookie, (me) => connection(me.userId, (c) => c.pollDeviceLogin(me.userId))),
      /** A pasted platform API key: fingerprinted for status, sealed for storage, never shown again. */
      dashboardLinkApiKey: (cookie: string, key: string) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const trimmed = key.trim();

            if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed))
              return yield* Effect.fail<DashboardFailure>({
                _tag: "InvalidKey",
                reason: "invalid-input",
              });

            const digest = yield* Effect.tryPromise({
              try: () =>
                globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(trimmed)),
              catch: (): DashboardFailure => ({ _tag: "Digest", reason: "failed" }),
            });

            const fingerprint = Array.from(new Uint8Array(digest), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");

            return yield* connection(me.userId, (c) =>
              c.link(me.userId, {
                userId: me.userId,
                provider: "openai-api",
                key: trimmed,
                fingerprint: `openai-api:${fingerprint}`,
              }),
            );
          }),
        ),
      dashboardRevokeConnection: (cookie: string, provider: Provider) =>
        authorized(cookie, (me) => connection(me.userId, (c) => c.revoke(me.userId, provider))),
      inboxSnapshot: (workspaceId: string) => inbox.snapshot(workspaceId),
      configureEnvironment: (workspaceId: string, provider: string, environment: Schema.Json) =>
        Effect.gen(function* () {
          const stored = yield* environments.set(
            workspaceId,
            provider,
            environment,
            yield* Clock.currentTimeMillis,
          );

          return {
            workspaceId: stored.workspaceId,
            provider: stored.provider,
            revision: stored.revision,
          };
        }),
    };

    // The cron and ingress kicks run the drain; it is no RPC method.
    return { worker, drain };
  });

export interface Interface {
  /** The Worker's fetch handler and binding RPC. */
  readonly worker: Worker;
  /** One pass over the durable inbox: due admissions forwarded to their task objects. */
  readonly drain: Effect.Effect<void, never, RuntimeContext>;
}

// A type, not an interface: Worker RPC shapes need its implicit index signature.
export type Worker = Effect.Success<ReturnType<typeof make>>["worker"];

export class Service extends Context.Service<Service, Interface>()("@notus/control/hosts/Api") {}

export const layerNoDeps = (settings: Settings) => Layer.effect(Service, make(settings));

/**
 * The API over this deployment's domains. Leaves the shared database, the sealing key, the
 * sign-in, background work and the three object namespaces to the app.
 */
export const layer = (settings: Settings) => {
  const dashboard = settings.dashboard;

  // Every source goes through the registry: ingress, delivery, installs and the dashboard's scope lists.
  const platforms = Layer.unwrap(
    Effect.map(ConnectionHost.Remote, (connections) =>
      platformsLayer(settings.deployment, settings.github, {
        webhookSecret: settings.webhookSecret,
        slack: dashboard.slack,
        githubAppSlug: dashboard.githubAppSlug,
        githubInstaller: dashboard.github === null ? null : githubInstaller(connections),
      }),
    ),
  ).pipe(Layer.provide(Credentials.layer));

  const domains = Layer.mergeAll(
    Workspaces.layer,
    Roles.layer,
    Environments.layer,
    Templates.layer,
    Compute.layer,
    Identities.layer,
    Inbox.layer.pipe(Layer.provide(platforms)),
    platforms,
  );

  return layerNoDeps(settings).pipe(
    Layer.provide([domains, runtimeAuthentication(settings.runtime)]),
    Layer.provide(cryptoLayer),
  );
};

/**
 * An install's proof of GitHub ownership is the installer's own sign-in, refreshed under their
 * Connection object's gate like every other use of it. Installs complete inside a dashboard call,
 * which carries the runtime context.
 */
const githubInstaller =
  (connections: (userId: string) => ConnectionHost.Interface) => (userId: string) =>
    Effect.serviceOption(RuntimeContext).pipe(
      Effect.flatMap((runtime) =>
        Option.isNone(runtime)
          ? Effect.fail(
              new InstallError({
                platform: "github",
                reason: "rejected",
                detail: "outside-handler",
              }),
            )
          : connections(userId)
              .githubLogin(userId, 60_000)
              .pipe(Effect.provideService(RuntimeContext, runtime.value)),
      ),
      Effect.flatMap((result) =>
        result.ok
          ? Effect.succeed(result.value === null ? null : Redacted.make(result.value.access))
          : result.reason === "not-linked"
            ? Effect.succeed(null)
            : Effect.fail(
                new InstallError({
                  platform: "github",
                  reason: "rejected",
                  detail: `github-sign-in ${result.reason}`,
                }),
              ),
      ),
    );

export * as ApiHost from "./api";
