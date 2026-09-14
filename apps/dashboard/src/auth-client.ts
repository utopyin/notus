import { createAuthClient } from "better-auth/react";

/**
 * Talks to Better Auth through this app's own `/auth` routes, which the server forwards to the
 * API Worker. Cookies therefore belong to the dashboard's origin. Slack is registered on the API
 * as a generic OAuth provider, so it signs in and links through the same social endpoints as GitHub.
 */
export const authClient = createAuthClient({ basePath: "/auth" });
export type Provider = "slack" | "github";
