import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";

const root = getRouteApi("__root__");

export const Route = createFileRoute("/workspaces")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/" });
  },
  component: Workspaces,
});

function Workspaces() {
  const me = root.useLoaderData();
  if (!me) return null;
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <h1 className="text-lg font-medium">Workspaces</h1>
      {me.workspaces.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          You are not a member of any workspace yet. Workspace creation and invites arrive in the
          next increment.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {me.workspaces.map((id) => (
            <li key={id} className="rounded-md border p-3">
              {id}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
