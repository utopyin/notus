import { BetterAuth } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import {
  genericOAuth,
  slack,
  type GenericOAuthConfig,
  type GenericOAuthUserInfo,
} from "better-auth/plugins/generic-oauth";
import { dashboardConfig, type DashboardConfig } from "@notus/control/config";
import { Sessions } from "@notus/control/dashboard/sessions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Redacted from "effect/Redacted";
import { SharedDb } from "@notus/db/shared";
import { within } from "./execution";

/**
 * Better Auth's tables live in the shared database, defined and migrated with the rest of the
 * account domain (`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`).
 */
const database = CloudflareD1(SharedDb.Database);

const slackUserInfo = "https://slack.com/api/openid.connect.userInfo";
const teamClaim = "https://slack.com/team_id";

/**
 * Sign in with Slack through Better Auth's generic OAuth provider, keeping the team ID: the
 * Slack source adapter resolves a mention's initiator by team and user, so the sign-in must
 * record both. The team lands on the user as `slackTeamId`; the user ID is the account subject.
 */
const slackProvider = (credentials: {
  clientId: string;
  clientSecret: string;
}): GenericOAuthConfig<"slack"> => {
  const base = slack(credentials);

  return {
    ...base,
    // Better Auth calls this as a plain Promise outside any Effect runtime.
    // oxlint-disable-next-line effecttsgo/async-function
    getUserInfo: async (tokens): Promise<GenericOAuthUserInfo | null> => {
      if (!tokens.accessToken) return null;

      // oxlint-disable-next-line effecttsgo/global-fetch
      const response = await fetch(slackUserInfo, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!response.ok) return null;

      const profile: {
        sub?: string;
        name?: string;
        email?: string;
        email_verified?: boolean;
        picture?: string;
        [teamClaim]?: string;
      } = await response.json();

      if (!profile.sub) return null;

      return {
        sub: profile.sub,
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
        emailVerified: profile.email_verified ?? false,
        slackTeamId: profile[teamClaim],
      };
    },
    mapProfileToUser: (profile) => ({
      slackTeamId: typeof profile.slackTeamId === "string" ? profile.slackTeamId : undefined,
    }),
  };
};

/**
 * The dashboard's sign-in, hosted by the API Worker under `/auth` so the API can validate every
 * session itself. The dashboard forwards `/auth/*` through its service binding, which keeps the
 * session cookie on the dashboard's origin. Providers without configured credentials are absent.
 */
const make = (dashboard: DashboardConfig) =>
  BetterAuth({
    id: "Auth",
    // The account domain's Drizzle migrations own the tables; Better Auth never migrates.
    migrate: false,
    basePath: "/auth",
    ...(dashboard.origin === null
      ? {}
      : { baseURL: dashboard.origin, trustedOrigins: [dashboard.origin] }),
    session: { modelName: "auth_sessions" },
    verification: { modelName: "auth_verifications" },
    user: {
      modelName: "auth_users",
      additionalFields: {
        slackTeamId: { type: "string", required: false, input: false },
        /** The login GitHub knows the user by; task branches are attributed under it. */
        githubLogin: { type: "string", required: false, input: false },
      },
    },
    account: {
      modelName: "auth_accounts",
      // Linking is an explicit action from the account page by a signed-in user, so the second
      // provider's email need not match: Slack and GitHub emails often differ for one person.
      // Never implicitly: a sign-in whose email matches an existing user is not that user, since
      // a Slack workspace owner chooses its members' emails. Trust only lets explicit links through
      // without a verified email, which GitHub's no-reply stand-in never has.
      accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        disableImplicitLinking: true,
        trustedProviders: ["github", "slack"],
      },
    },
    socialProviders:
      dashboard.github === null
        ? {}
        : {
            github: {
              clientId: dashboard.github.clientId,
              clientSecret: Redacted.value(dashboard.github.clientSecret),
              // A GitHub App's user token ignores the email scope, so a private email comes back
              // empty. GitHub's no-reply address stands in; it is unique and not used for mail.
              mapProfileToUser: (profile) => ({
                email: profile.email ?? `${profile.id}+${profile.login}@users.noreply.github.com`,
                githubLogin: profile.login,
              }),
            },
          },
    plugins:
      dashboard.slack === null
        ? []
        : [
            genericOAuth({
              config: [
                slackProvider({
                  clientId: dashboard.slack.clientId,
                  clientSecret: Redacted.value(dashboard.slack.clientSecret),
                }),
              ],
            }),
          ],
  });

/**
 * The sign-in instance this Worker hosts, built once from the dashboard's configuration. Its calls
 * run in the current execution; the adapters below run them through `within`.
 *
 * @effect-expect-leaking RuntimeContext
 */
export class Auth extends Context.Service<Auth, Effect.Success<ReturnType<typeof make>>>()(
  "@notus/api/Auth",
) {}

export const layer = Layer.effect(Auth, Effect.flatMap(dashboardConfig, make)).pipe(
  Layer.provide(database),
);

/** Better Auth's own routes, which the dashboard forwards through its service binding. */
export const routes = HttpRouter.use((router) =>
  Effect.flatMap(Auth, (auth) => router.add("*", "/auth/*", auth.fetch)),
);

/** The dashboard's sessions over Better Auth; the API reads nothing else of it. */
export const sessions = Layer.effect(
  Sessions.Service,
  Effect.gen(function* () {
    const auth = yield* Auth;

    const failure = (operation: string) => (cause: unknown) =>
      new Sessions.SessionError({ operation, cause });

    return Sessions.Service.of({
      signIn: (cookie) =>
        Effect.gen(function* () {
          const headers = new Headers({ cookie });
          const session = yield* auth.getSession(headers);
          if (session === null) return null;

          const accounts = yield* auth.api.listUserAccounts({ headers });

          return {
            sessionId: session.session.id,
            user: {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              image: session.user.image ?? null,
              slackTeamId: session.user.slackTeamId ?? null,
              githubLogin: session.user.githubLogin ?? null,
            },
            accounts: accounts.map((account) => ({
              id: account.id,
              providerId: account.providerId,
              accountId: account.accountId,
              createdAt: account.createdAt,
            })),
          };
        }).pipe(within, Effect.mapError(failure("signIn"))),
      list: (cookie) =>
        auth.api.listSessions({ headers: new Headers({ cookie }) }).pipe(
          within,
          Effect.map((listed) =>
            listed.map((session) => ({
              id: session.id,
              createdAt: session.createdAt,
              userAgent: session.userAgent ?? null,
            })),
          ),
          Effect.mapError(failure("list")),
        ),
      // The token never leaves this Worker: revocation goes by the session's ID.
      revoke: (cookie, sessionId) =>
        Effect.gen(function* () {
          const headers = new Headers({ cookie });
          const listed = yield* auth.api.listSessions({ headers });
          const session = listed.find((candidate) => candidate.id === sessionId);

          if (session === undefined) return false;

          yield* auth.api.revokeSession({ headers, body: { token: session.token } });

          return true;
        }).pipe(within, Effect.mapError(failure("revoke"))),
    });
  }),
);
