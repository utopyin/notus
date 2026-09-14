import { createAuthClient } from "better-auth/react";

/**
 * Talks to Better Auth through this app's own `/auth` routes, which the server forwards to the
 * API Worker. Cookies therefore belong to the dashboard's origin.
 */
export const authClient = createAuthClient({ basePath: "/auth" });

/** Sign in with Slack goes through the generic OAuth route the API configures as `slack`. */
export const signInWithSlack = (callbackURL: string) =>
  authClient.$fetch<{ url: string; redirect: boolean }>("/sign-in/oauth2", {
    method: "POST",
    body: { providerId: "slack", callbackURL },
  });
export const linkSlack = (callbackURL: string) =>
  authClient.$fetch<{ url: string; redirect: boolean }>("/oauth2/link", {
    method: "POST",
    body: { providerId: "slack", callbackURL },
  });
