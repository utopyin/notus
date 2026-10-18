import { createFileRoute } from "@tanstack/react-router";
import { call } from "../server/api";

/**
 * Where the API bounces a platform's install redirect, so it reaches the API again with this
 * origin's session cookie: the API completes the install only for the user who began it.
 */
export const Route = createFileRoute("/platforms/$platform/install")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const result = await call(
          (api) =>
            api.completeInstall({ platform: params.platform, search: new URL(request.url).search }),
          request.headers.get("cookie") ?? "",
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
