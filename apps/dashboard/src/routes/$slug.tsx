import {
  Outlet,
  createFileRoute,
  getRouteApi,
  notFound,
  redirect,
  useMatches,
} from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
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
  component: Layout,
});

/**
 * The shell is mounted once here and the pages render into it, so navigating between them keeps
 * the sidebar (and its live pieces, like the workspace mark) in place. Each page declares its
 * header through `staticData.shell`; the overview leaves the title to the workspace itself.
 */
function Layout() {
  const { me, view, current } = useWorkspace();
  const shell = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.shell)?.staticData.shell,
  });
  const activePlatform = useMatches({
    select: (matches) => {
      const params: unknown = matches.at(-1)?.params;
      return typeof params === "object" &&
        params !== null &&
        "platform" in params &&
        typeof params.platform === "string"
        ? params.platform
        : undefined;
    },
  });
  if (!me) return null;
  return (
    <AppShell
      me={me}
      current={current}
      active={shell?.active}
      activePlatform={activePlatform}
      title={shell?.title === null ? null : (shell?.title ?? view.workspace.name)}
      description={shell?.title ? shell.description : `notus.run/${view.workspace.slug}`}
    >
      <Outlet />
    </AppShell>
  );
}

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
