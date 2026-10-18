import { createAuthClient } from "better-auth/react";

/**
 * Talks to Better Auth through this app's own `/auth` routes, so cookies belong to the dashboard's
 * origin. Slack signs in and links through the same social endpoints as GitHub.
 */
export const authClient = createAuthClient({ basePath: "/auth" });
export type Provider = "slack" | "github";
