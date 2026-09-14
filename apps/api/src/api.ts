import { D1 } from "@notus/cloudflare/d1";
import { Inbox } from "@notus/control/inbox";
import { Identities } from "@notus/accounts/identities";
import type { Actor } from "@notus/contracts/source";
import { Slack } from "@notus/slack/service";
import { Environments } from "@notus/workspaces/environments";
import type { Role } from "@notus/workspaces/types";
import { Workspaces } from "@notus/workspaces/workspaces";
import * as Clock from "effect/Clock";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { CurrentRuntimeContext, RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { hostnames, zone } from "@notus/stages/hosts";
import * as Callback from "./callback";
import { App as GithubApp } from "@notus/github/app";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { authDatabase, makeAuth } from "./auth";
import {
  dashboardConfig,
  deploymentConfig,
  githubConfig,
  repositoryConfig,
  runtimeConfig,
  webhookConfig,
} from "./config";
import * as GithubHook from "./github";
import { Connection } from "./connection";
import * as RuntimeLayers from "./runtime";
import { cryptoLayer } from "./crypto";
import { SharedDatabase } from "./database";
import { handler } from "./http";
import { Task } from "./task";

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  Stack.useSync(({ stage }) => ({
    main: import.meta.url,
    domain: { name: hostnames(stage).api, zoneName: zone },
  })),
  Effect.gen(function* () {
    const config = yield* deploymentConfig;
    const callbackSettings = yield* runtimeConfig.pipe(Effect.orDie);
    const repository = yield* repositoryConfig.pipe(Effect.orDie);
    const github = yield* githubConfig.pipe(Effect.orDie);
    const webhookSecret = yield* webhookConfig.pipe(Effect.orDie);
    const dashboard = yield* dashboardConfig.pipe(Effect.orDie);
    // Sign-in for the dashboard. Sessions are validated here, never trusted from the dashboard.
    const auth = yield* makeAuth(dashboard);
    const githubApp = github
      ? GithubApp.layer.pipe(
          Layer.provide([Layer.succeed(GithubApp.Configuration, github), FetchHttpClient.layer]),
        )
      : GithubApp.disabled;
    const tasks = yield* Task;
    const connections = yield* Connection;
    const database = yield* SharedDatabase;
    const binding = yield* Cloudflare.D1.QueryDatabase(database);
    const execution = yield* Cloudflare.WorkerExecutionContext;
    // Alchemy supplies this during initialization, not in event contexts.
    const runtime = yield* CurrentRuntimeContext;
    if (!runtime) return yield* Effect.die("Api initialization requires Alchemy RuntimeContext");
    // Build this graph in each execution, never in the isolate constructor.
    // A waitUntil pass opens its own scope rather than retaining fetch's D1 client.
    const inboxLayer = Layer.merge(Inbox.layer, Environments.layer).pipe(
      Layer.provide([Layer.effect(D1.Binding, binding.raw), cryptoLayer]),
    );
    const withInbox = <A, E, R>(run: (inbox: Inbox.Interface) => Effect.Effect<A, E, R>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const inbox = yield* Inbox.Service;
          yield* inbox.seedFixture(
            github && repository
              ? {
                  ...config,
                  github: {
                    installationId: github.installationId,
                    fullName: `${repository.owner}/${repository.name}`,
                  },
                }
              : config,
          );
          return yield* run(inbox);
        }).pipe(Effect.provide(inboxLayer)),
      );
    const drain = withInbox((inbox) =>
      Effect.gen(function* () {
        const environments = yield* Environments.Service;
        return yield* inbox.drain((command) =>
          Effect.gen(function* () {
            const task = tasks.getByName(command.reservation.taskId);
            const result = yield* task.admit(command);
            if (!result.ok) return yield* Effect.fail("task_admission_rejected");
            if (result.needsEnvironment) {
              const environment = yield* environments.get(command.reservation.workspaceId);
              const prepared = yield* task.prepareEnvironment(
                Option.getOrNull(environment),
                repository,
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
      }
    }).pipe(
      Effect.provide(RuntimeLayers.authentication(callbackSettings)),
      Effect.provideService(RuntimeContext, runtime),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 })),
    );
    const slack = handler(
      config,
      (input) => withInbox((inbox) => inbox.admit(input)),
      execution.waitUntil(drain),
    );
    // GitHub ingress dependencies: one tagged failure, with the runtime context provided up front.
    const ingress = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(() => new GithubHook.IngressFailure({})),
        Effect.provideService(RuntimeContext, runtime),
      );
    const githubHook =
      github && repository && webhookSecret
        ? GithubHook.handler({
            workspaceId: config.workspaceId,
            installationId: github.installationId,
            repository: { owner: repository.owner, name: repository.name },
            secret: webhookSecret,
            role: (login) =>
              ingress(
                GithubApp.Service.pipe(
                  Effect.flatMap((app) => app.collaboratorRole(repository, login)),
                  Effect.provide(githubApp),
                ),
              ),
            routeOf: (conversationKey) =>
              ingress(withInbox((inbox) => inbox.routeOf(conversationKey))),
            confirm: (taskId, source) =>
              ingress(
                tasks
                  .getByName(taskId)
                  .attachPullRequest(source)
                  .pipe(Effect.map((result) => (result.ok ? result.value : null))),
              ),
            attach: (route) => ingress(withInbox((inbox) => inbox.attach(route))),
            admit: (input) => ingress(withInbox((inbox) => inbox.admit(input)).pipe(Effect.asVoid)),
            kick: ingress(execution.waitUntil(drain)),
          })
        : null;
    // Dashboard services: workspace administration, identity adoption and the Slack channel list.
    const dashboardLayer = Layer.mergeAll(
      Workspaces.layer,
      Identities.layer,
      Slack.layer.pipe(
        Layer.provide(
          Layer.succeed(Slack.Configuration, {
            token: config.token,
            allowedChannel: config.channelId,
          }),
        ),
      ),
    ).pipe(Layer.provide([Layer.effect(D1.Binding, binding.raw), cryptoLayer]));
    type DashboardDeps = Workspaces.Service | Identities.Service | Slack.Service;
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
              kind: "slack",
              installationId: session.user.slackTeamId,
              externalId: account.accountId,
            });
          if (account.providerId === "github")
            actors.push({ kind: "github", installationId: "oauth", externalId: account.accountId });
        }
        const now = yield* Clock.currentTimeMillis;
        const userId = yield* Identities.Service.pipe(
          Effect.flatMap((identities) =>
            identities.adopt({ authUserId: session.user.id, actors, now }),
          ),
        );
        return { session, accounts, userId, now };
      }).pipe(Effect.provideService(RuntimeContext, runtime));
    type SignedIn = NonNullable<Effect.Success<ReturnType<typeof signedIn>>>;
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
        if (path === "/github/events")
          return yield* githubHook ?? Effect.succeed(HttpServerResponse.empty({ status: 404 }));
        if (path === "/auth" || path.startsWith("/auth/")) return yield* auth.fetch;
        return yield* path.startsWith("/runtime/") ? callback : slack;
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
      dashboardCreateWorkspace: (cookie: string, name: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.create(me.userId, name, me.now)),
          ),
        ),
      dashboardWorkspace: (cookie: string, workspaceId: string) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) => workspaces.view(workspaceId, me.userId)),
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
      dashboardAddChannel: (
        cookie: string,
        workspaceId: string,
        teamId: string,
        channelId: string,
      ) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) =>
              workspaces.addChannel(workspaceId, me.userId, { teamId, channelId }),
            ),
          ),
        ),
      dashboardRemoveChannel: (
        cookie: string,
        workspaceId: string,
        teamId: string,
        channelId: string,
      ) =>
        authorized(cookie, (me) =>
          Workspaces.Service.pipe(
            Effect.flatMap((workspaces) =>
              workspaces.removeChannel(workspaceId, me.userId, { teamId, channelId }),
            ),
          ),
        ),
      /** The installed Slack team's channels, for admins picking what a workspace listens to. */
      dashboardSlackChannels: (cookie: string) =>
        authorized(cookie, () =>
          Slack.Service.pipe(
            Effect.flatMap((slack) => slack.listChannels),
            Effect.map((channels) => ({ teamId: config.teamId, channels })),
          ),
        ),
      // Status only: no method here returns or accepts provider tokens.
      connectionStatus: (userId: string) => connections.getByName(userId).status(userId),
      revokeConnection: (userId: string) => connections.getByName(userId).revoke(userId),
      inboxSnapshot: () => withInbox((inbox) => inbox.snapshot(config.workspaceId)),
      configureEnvironment: (provider: string, environment: Schema.Json) =>
        withInbox(() =>
          Effect.gen(function* () {
            const environments = yield* Environments.Service;
            const stored = yield* environments.set(config.workspaceId, provider, environment);
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
