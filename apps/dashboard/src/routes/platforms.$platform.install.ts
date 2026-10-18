import { createFileRoute } from "@tanstack/react-router";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";

/**
 * Where the API bounces a platform's install redirect, so it reaches the API again with this
 * origin's session cookie: the API completes the install only for the user who began it.
 */
export const Route = createFileRoute("/platforms/$platform/install")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const api = Cloudflare.toRpcAsync<Api>(env.API);
        const result = await api.dashboardCompleteInstall(
          request.headers.get("cookie") ?? "",
          params.platform,
          new URL(request.url).search,
        );
        const location = result.ok
          ? result.value.location
          : result.reason === "unauthorized"
            ? "/sign-in"
            : `/?install=${encodeURIComponent(result.reason)}`;

        return new Response(null, { status: 302, headers: { location } });
      },
    },
  },
});
