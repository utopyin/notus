import { createFileRoute } from "@tanstack/react-router";
import { env } from "../env";

/**
 * Every Better Auth route is served by the API Worker. Forwarding through the service binding
 * keeps the API private and sets the session cookie on this origin.
 */
export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => await env.API.fetch(request),
    },
  },
});
