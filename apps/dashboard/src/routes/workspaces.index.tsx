import { Link, createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createWorkspace } from "../server/workspaces";

const root = getRouteApi("__root__");

export const Route = createFileRoute("/workspaces/")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/" });
  },
  component: Workspaces,
});

function Workspaces() {
  const me = root.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!me) return null;
  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    const result = await createWorkspace({ data: { name } });
    setCreating(false);
    if (!result.ok) {
      setMessage(`Could not create the workspace (${result.reason}).`);
      return;
    }
    setName("");
    await router.invalidate();
    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: result.value.id },
    });
  };
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <h1 className="text-lg font-medium">Workspaces</h1>
      {me.workspaces.length === 0 ? (
        <p className="text-muted-foreground text-sm">You are not a member of any workspace yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {me.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to="/workspaces/$workspaceId"
                params={{ workspaceId: workspace.id }}
                className="hover:bg-accent flex items-center justify-between rounded-md border p-3"
              >
                <span className="font-medium">{workspace.name}</span>
                <span className="text-muted-foreground">{workspace.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">New workspace</span>
          <input
            className="rounded-md border px-3 py-2"
            value={name}
            placeholder="Team name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={creating || !name.trim()}>
          Create
        </Button>
      </form>
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </main>
  );
}
