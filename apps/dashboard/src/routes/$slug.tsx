import { Outlet, createFileRoute, getRouteApi, notFound, redirect } from "@tanstack/react-router";
import { getWorkspaceBySlug } from "../server/workspaces";

const root = getRouteApi("__root__");

/**
 * Every workspace page lives under the workspace's slug. The layout loads the workspace once and
 * refuses slugs the user is not a member of the same way as unknown ones.
 */
export const Route = createFileRoute("/$slug")({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/sign-in" });
    const result = await getWorkspaceBySlug({ data: { slug: params.slug } });
    if (!result.ok) throw notFound();
    return result.value;
  },
  component: () => <Outlet />,
});

/** The current workspace, for pages under the slug. */
export const useWorkspace = () => {
  const me = root.useLoaderData();
  const view = Route.useLoaderData();
  const current = me?.workspaces.find((w) => w.id === view.workspace.id) ?? {
    id: view.workspace.id,
    name: view.workspace.name,
    slug: view.workspace.slug,
    role: view.role,
  };
  return { me, view, current };
};
