import { createFileRoute, redirect } from "@tanstack/react-router";

/** There is no home page: sign in, create a first workspace, or land in the first workspace. */
export const Route = createFileRoute("/")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    const me = parent.loaderData;
    if (!me) throw redirect({ to: "/sign-in" });
    const first = me.workspaces[0];
    if (!first) throw redirect({ to: "/welcome" });
    throw redirect({ to: "/$slug", params: { slug: first.slug } });
  },
});
