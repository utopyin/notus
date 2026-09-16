import { D1 } from "@notus/cloudflare/d1";
import { Inbox } from "@notus/control/inbox";
import { Identities } from "@notus/accounts/identities";
import { InstallationId, PlatformId } from "@notus/platform/ids";
import { Platform } from "@notus/platform/platform";
import { Platforms } from "@notus/platforms/registry";
import type { Actor } from "@notus/platform/source";
import type { Provider } from "@notus/openai/types";
import { Environments } from "@notus/workspaces/environments";
import { validateRestricted } from "@notus/namespace/service";
import type { Role, WorkspaceView } from "@notus/workspaces/types";
import type { ScopeInput } from "@notus/workspaces/workspaces";
import { Sealed } from "@notus/cloudflare/sealed";
import { Credentials } from "@notus/workspaces/credentials";
import { Workspaces } from "@notus/workspaces/workspaces";
import { Roles } from "@notus/workspaces/roles";
import { PLATFORM_DESCRIPTORS } from "@notus/platform/descriptors/index";
import * as Install from "./install";
import * as Clock from "effect/Clock";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { CurrentRuntimeContext, RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { hostnames, zone } from "@notus/shared/hosts";
import * as Callback from "./callback";
import { authDatabase, makeAuth } from "./auth";
import {
  approvedImageConfig,
  credentialKeyConfig,
  dashboardConfig,
  deploymentConfig,
  githubConfig,
  runtimeConfig,
  webhookConfig,
} from "./config";
import * as Ingress from "./ingress";
import { platformsLayer } from "./platforms";
import { Connection } from "./connection";
import * as RuntimeLayers from "./runtime";
import { cryptoLayer } from "./crypto";
import { SharedDatabase } from "./database";
import { Task } from "./task";

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  Stack.useSync(({ stage }) => ({
    main: import.meta.url,
    domain: { name: hostnames(stage).api, zoneName: zone },
    // One origin per stage: no workers.dev name beside the custom domain.
    workersDev: false,
  })),
  Effect.gen(function* () {
    const config = yield* deploymentConfig;
    const callbackSettings = yield* runtimeConfig.pipe(Effect.orDie);
    const github = yield* githubConfig.pipe(Effect.orDie);
    // What the dashboard may select as a devbox image: exactly what the host would launch.
    const approved = yield* approvedImageConfig.pipe(Effect.orDie);
    const webhookSecret = yield* webhookConfig.pipe(Effect.orDie);
    const dashboard = yield* dashboardConfig.pipe(Effect.orDie);
    // Every credential at rest, model login or platform installation, is sealed under this key.
    const sealed = Sealed.layer(yield* credentialKeyConfig.pipe(Effect.orDie));
    // Sign-in for the dashboard. Sessions are validated here, never trusted from the dashboard.
    const auth = yield* makeAuth(dashboard);
    const tasks = yield* Task;
    const connections = yield* Connection;
    const database = yield* SharedDatabase;
    const binding = yield* Cloudflare.D1.QueryDatabase(database);
    const execution = yield* Cloudflare.WorkerExecutionContext;
    // Alchemy supplies this during initialization, not in event contexts.
    const runtime = yield* CurrentRuntimeContext;
    if (!runtime) return yield* Effect.die("Api initialization requires Alchemy RuntimeContext");
    // Every source goes through the registry: ingress, delivery, installs and the dashboard's scope lists.
    const d1 = Layer.effect(D1.Binding, binding.raw);
    const platforms = platformsLayer(config, github, {
      webhookSecret,
      slack: dashboard.slack,
      githubAppSlug: dashboard.githubAppSlug,
    }).pipe(
      Layer.provide(Credentials.layer.pipe(Layer.provide([d1, sealed]))),
      Layer.provide(Layer.succeed(RuntimeContext, runtime)),
      // The credential store's database client is deployment configuration; failing it is a defect.
      Layer.orDie,
    );
    // Build this graph in each execution, never in the isolate constructor.
    // A waitUntil pass opens its own scope rather than retaining fetch's D1 client.
    const inboxLayer = Layer.mergeAll(Inbox.layer, Environments.layer, Roles.layer).pipe(
      Layer.provide([d1, cryptoLayer, platforms]),
    );
    const withInbox = <A, E, R>(run: (inbox: Inbox.Interface) => Effect.Effect<A, E, R>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const inbox = yield* Inbox.Service;
          return yield* run(inbox);
        }).pipe(Effect.provide(inboxLayer)),
      );
    const drain = withInbox((inbox) =>
      Effect.gen(function* () {
        const environments = yield* Environments.Service;
        const roles = yield* Roles.Service;
        return yield* inbox.drain((command) =>
          Effect.gen(function* () {
            const task = tasks.getByName(command.reservation.taskId);
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
          }).pipe(Effect.provideService(RuntimeContext, runtime)),
        );
      }),
    ).pipe(
      Effect.flatMap((counts) => Effect.logInfo("inbox.drain", counts)),
      Effect.catch(() => Effect.logError("inbox.drain_failed")),
      // Alchemy's cron wrapper catches defects; log before that boundary.
      Effect.tapCause(() => Effect.logError("inbox.drain_defect")),
    );
    yield* Cloudflare.Workers.cron("* * * * *", () => drain);
    const callback = Callback.handler((capability, request) => {
      const task = tasks.getByName(capability.bootstrap.taskId);
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
      Effect.provide(RuntimeLayers.authentication(callbackSettings)),
      Effect.provideService(RuntimeContext, runtime),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 })),
    );
    // Ingress dependencies: one tagged failure, with the runtime context provided up front.
    const failing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(() => new Ingress.IngressFailure({})),
        Effect.provideService(RuntimeContext, runtime),
      );
    const ingressDependencies: Ingress.Dependencies = {
      workspaceOf: (ref) => failing(withInbox((inbox) => inbox.workspaceOf(ref))),
      covers: (workspaceId, source) =>
        failing(withInbox((inbox) => inbox.covers(workspaceId, source))),
      routeOf: (conversationKey) => failing(withInbox((inbox) => inbox.routeOf(conversationKey))),
      admit: (input) =>
        withInbox((inbox) => inbox.admit(input)).pipe(
          Effect.mapError((error) =>
            error._tag === "Control.Unauthorized" ||
            error._tag === "Control.Conflict" ||
            error._tag === "Control.IntakeError"
              ? error
              : new Ingress.IngressFailure({}),
          ),
          Effect.provideService(RuntimeContext, runtime),
        ),
      kick: failing(execution.waitUntil(drain)),
    };
    const ingress = {
      slack: Ingress.handler("slack", ingressDependencies).pipe(Effect.provide(platforms)),
      github: Ingress.handler("github", ingressDependencies).pipe(Effect.provide(platforms)),
    };
    // Dashboard services: workspace administration, identity adoption and the platforms' scope lists.
    const dashboardLayer = Layer.mergeAll(
      Workspaces.layer,
      Roles.layer,
      Environments.layer,
      Identities.layer,
      platforms,
    ).pipe(Layer.provide([d1, cryptoLayer, sealed]));
    // The platform's redirect after an install; it needs the dashboard's origin to land on.
    const install = dashboard.origin
      ? Install.callback(dashboard.origin).pipe(
          Effect.scoped,
          Effect.provide(dashboardLayer),
          Effect.provideService(RuntimeContext, runtime),
          Effect.orDie,
        )
      : Effect.succeed(HttpServerResponse.empty({ status: 404 }));
    /** Which platforms this deployment can install; the dashboard offers exactly these. */
    const installable: ReadonlyArray<Platform> = [
      ...(dashboard.slack ? (["slack"] as const) : []),
      ...(dashboard.githubAppSlug ? (["github"] as const) : []),
    ];
    type DashboardDeps =
      | Workspaces.Service
      | Roles.Service
      | Environments.Service
      | Identities.Service
      | Platforms.Service;
    /**
     * Resolves the signed-in dashboard user from the forwarded cookie: the Better Auth session,
     * its linked provider accounts as verified identities, and the canonical Notus user those
     * identities adopt. Anonymous requests yield null; nothing here is trusted from the caller.
     */
    const signedIn = (cookie: string) =>
      Effect.gen(function* () {
        const headers = new Headers({ cookie });
        const session = yield* auth.getSession(headers);
        if (session === null) return null;
        const accounts = yield* auth.api.listUserAccounts({ headers });
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
        const userId = yield* Identities.Service.pipe(
          Effect.flatMap((identities) =>
            identities.adopt({
              authUserId: session.user.id,
              actors,
              profile: {
                name: session.user.name,
                email: session.user.email,
                image: session.user.image ?? null,
                githubLogin: session.user.githubLogin ?? null,
              },
              now,
            }),
          ),
        );
        return { session, accounts, userId, now };
      }).pipe(Effect.provideService(RuntimeContext, runtime));
    type SignedIn = NonNullable<Effect.Success<ReturnType<typeof signedIn>>>;
    /** Member rows carry the display profile of their user, when one has signed in. */
    const withProfiles = (view: WorkspaceView) =>
      Identities.Service.pipe(
        Effect.flatMap((identities) => identities.profiles(view.members.map((m) => m.userId))),
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
        object: ReturnType<typeof connections.getByName>,
      ) => Effect.Effect<
        { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string },
        never,
        RuntimeContext
      >,
    ) =>
      call(connections.getByName(userId)).pipe(
        Effect.provideService(RuntimeContext, runtime),
        Effect.flatMap((result) =>
          result.ok
            ? Effect.succeed(result.value)
            : Effect.fail<DashboardFailure>({ _tag: "Connection", reason: result.reason }),
        ),
      );
    /** RPC results carry a reason string instead of an error class the dashboard cannot decode. */
    interface DashboardFailure {
      readonly _tag: string;
      readonly reason?: string;
    }
    const dashboardResult = <A>(effect: Effect.Effect<A, DashboardFailure, DashboardDeps>) =>
      effect.pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) =>
          Effect.logWarning(`dashboard.rpc_failed ${error._tag} ${error.reason ?? ""}`).pipe(
            Effect.as({ ok: false as const, reason: error.reason ?? "failed" }),
          ),
        ),
        Effect.scoped,
        Effect.provide(dashboardLayer),
        Effect.orElseSucceed(() => ({ ok: false as const, reason: "failed" })),
      );
    const authorized = <A>(
      cookie: string,
      run: (me: SignedIn) => Effect.Effect<A, DashboardFailure, DashboardDeps>,
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
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://notus.invalid").pathname;
        if (request.method === "GET" && path === "/health") return HttpServerResponse.text("ok");
        // Every platform's deliveries arrive at /<platform>/events.
        const events = /^\/([a-z]+)\/events$/.exec(path)?.[1];
        if (events !== undefined && Schema.is(Platform)(events)) return yield* ingress[events];
        if (path === "/auth" || path.startsWith("/auth/")) return yield* auth.fetch;
        if (/^\/platforms\/[a-z]+\/install$/.test(path)) return yield* install;
        if (path.startsWith("/runtime/")) return yield* callback;
        return HttpServerResponse.empty({ status: 404 });
      }),
      // Binding RPC only. No fetch route exposes task state or seed authority.
      snapshot: (taskId: string) => tasks.getByName(taskId).snapshot(),
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
              : Workspaces.Service.pipe(
                  Effect.flatMap((workspaces) => workspaces.listMine(me.userId)),
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
          Effect.scoped,
          Effect.provide(dashboardLayer),
          Effect.tapError((error) => Effect.logWarning(`dashboard.me_failed ${error._tag}`)),
          Effect.orElseSucceed(() => null),
        ),
      /** The signed-in user's sessions without their tokens beyond what revocation needs. */
      dashboardSessions: (cookie: string) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            const sessions = yield* auth.api.listSessions({ headers: new Headers({ cookie }) });
            return sessions
              .map((session) => ({
                id: session.id,
                token: session.token,
                createdAt: session.createdAt.toISOString(),
                userAgent: session.userAgent ?? null,
                current: session.id === me.session.session.id,
              }))
              .sort((a, b) =>
                a.current ? -1 : b.current ? 1 : b.createdAt.localeCompare(a.createdAt),
              );
          }).pipe(Effect.provideService(RuntimeContext, runtime)),
        ),
      dashboardCreateWorkspace: (cookie: string, name: string, slug?: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.create(me.userId, { name, slug }, me.now)),
          ),
        ),
      dashboardUpdateWorkspace: (
        cookie: string,
        workspaceId: string,
        input: { readonly name?: string; readonly slug?: string },
      ) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.update(workspaceId, me.userId, input)),
          ),
        ),
      dashboardWorkspace: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.view(workspaceId, me.userId)),
            Effect.flatMap(withProfiles),
          ),
        ),
      dashboardWorkspaceBySlug: (cookie: string, slug: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.viewBySlug(slug, me.userId)),
            Effect.flatMap(withProfiles),
          ),
        ),
      dashboardSetRole: (cookie: string, workspaceId: string, userId: string, role: Role) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) =>
              workspaces.setRole(workspaceId, me.userId, userId, role),
            ),
          ),
        ),
      dashboardRemoveMember: (cookie: string, workspaceId: string, userId: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.removeMember(workspaceId, me.userId, userId)),
          ),
        ),
      dashboardCreateInvite: (cookie: string, workspaceId: string, role: Role) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) =>
              workspaces.createInvite(workspaceId, me.userId, role, me.now),
            ),
          ),
        ),
      dashboardRevokeInvite: (cookie: string, workspaceId: string, inviteId: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) =>
              workspaces.revokeInvite(workspaceId, me.userId, inviteId, me.now),
            ),
          ),
        ),
      dashboardAcceptInvite: (cookie: string, token: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.acceptInvite(token, me.userId, me.now)),
          ),
        ),
      /** Where to send an admin to install a platform for the workspace; the intent outlives the round trip. */
      dashboardInstallUrl: (cookie: string, workspaceId: string, platform: Platform) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            if (!dashboard.origin)
              return yield* Effect.fail<DashboardFailure>({
                _tag: "Unconfigured",
                reason: "unconfigured",
              });
            const workspaces = yield* Workspaces.Service;
            const intent = yield* workspaces.beginInstall(workspaceId, me.userId, platform, me.now);
            const platforms = yield* Platforms.Service;
            const scope = yield* platforms.forPlatform(platform);
            const { url } = yield* scope.installing.begin({
              state: intent.nonce,
              redirectUri: Install.redirectUriOf(dashboard.origin, platform),
            });
            return { url };
          }),
        ),
      dashboardUninstall: (
        cookie: string,
        workspaceId: string,
        platform: Platform,
        installationId: string,
      ) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) =>
              workspaces.uninstall(workspaceId, me.userId, { platform, installationId }),
            ),
          ),
        ),
      dashboardAddScope: (cookie: string, workspaceId: string, source: ScopeInput) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.addScope(workspaceId, me.userId, source)),
          ),
        ),
      dashboardRemoveScope: (cookie: string, workspaceId: string, source: ScopeInput) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.removeScope(workspaceId, me.userId, source)),
          ),
        ),
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
            const workspaces = yield* Workspaces.Service;
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
            const platforms = yield* Platforms.Service;
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
      // Status only: no method here returns provider tokens.
      connectionStatus: (userId: string) => connections.getByName(userId).status(userId),
      revokeConnection: (userId: string, provider: Provider) =>
        connections.getByName(userId).revoke(userId, provider),
      /** The signed-in user's model connections: status projections, never material. */
      /** The workspace's specialist roles: current text and revision each. */
      dashboardRoles: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          Roles.Service.pipe(Effect.flatMap((roles) => roles.list(workspaceId, me.userId))),
        ),
      dashboardRoleHistory: (cookie: string, workspaceId: string, name: string) =>
        authorized(cookie, (me) =>
          Roles.Service.pipe(
            Effect.flatMap((roles) => roles.history(workspaceId, me.userId, name)),
          ),
        ),
      dashboardSaveRole: (
        cookie: string,
        workspaceId: string,
        name: string,
        summary: string,
        body: string,
      ) =>
        authorized(cookie, (me) =>
          Roles.Service.pipe(
            Effect.flatMap((roles) =>
              roles.save(workspaceId, me.userId, name, summary, body, me.now),
            ),
          ),
        ),
      dashboardDeleteRole: (cookie: string, workspaceId: string, name: string) =>
        authorized(cookie, (me) =>
          Roles.Service.pipe(Effect.flatMap((roles) => roles.remove(workspaceId, me.userId, name))),
        ),
      /** The workspace's devbox configuration and the images this deployment approves for it. */
      dashboardEnvironment: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          Environments.Service.pipe(
            Effect.flatMap((environments) => environments.view(workspaceId, me.userId)),
            Effect.map((environment) => ({
              environment: Option.getOrNull(environment),
              approvedImages: approved ? [approved.approvedImageRef] : [],
            })),
          ),
        ),
      dashboardEnvironmentHistory: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          Environments.Service.pipe(
            Effect.flatMap((environments) => environments.history(workspaceId, me.userId)),
          ),
        ),
      /** The provider's policy decides before anything is stored; its message is what the page shows. */
      dashboardSaveEnvironment: (cookie: string, workspaceId: string, config: Schema.Json) =>
        authorized(cookie, (me) =>
          Effect.gen(function* () {
            if (!approved)
              return yield* Effect.fail<DashboardFailure>({
                _tag: "Environment",
                reason: "This deployment approves no devbox image.",
              });
            yield* validateRestricted({
              config,
              approvedImageRef: approved.approvedImageRef,
              approvedImageSource: approved.approvedImageSource,
            }).pipe(
              Effect.mapError((error): DashboardFailure => ({
                _tag: error._tag,
                reason: error.message,
              })),
            );
            const environments = yield* Environments.Service;
            return yield* environments.save(workspaceId, me.userId, "namespace", config, me.now);
          }),
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
      inboxSnapshot: (workspaceId: string) => withInbox((inbox) => inbox.snapshot(workspaceId)),
      configureEnvironment: (workspaceId: string, provider: string, environment: Schema.Json) =>
        withInbox(() =>
          Effect.gen(function* () {
            const environments = yield* Environments.Service;
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
        ),
    };
  }).pipe(
    Effect.provide([
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.Workers.CronEventSourceLive,
      authDatabase,
    ]),
  ),
) {}
