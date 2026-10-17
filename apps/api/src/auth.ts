import { BetterAuth } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import {
  genericOAuth,
  slack,
  type GenericOAuthConfig,
  type GenericOAuthUserInfo,
} from "better-auth/plugins/generic-oauth";
import * as Redacted from "effect/Redacted";
import type { DashboardConfig } from "./config";
import { SharedDatabase } from "./database";

/**
 * Better Auth's tables live in the shared database, defined and migrated with the rest of the
 * account domain (`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`).
 */
export const authDatabase = CloudflareD1(SharedDatabase);

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
export const makeAuth = (dashboard: DashboardConfig) =>
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
