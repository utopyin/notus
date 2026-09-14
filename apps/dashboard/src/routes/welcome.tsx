import { createFileRoute, getRouteApi, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugOf, validSlug } from "../lib/slug";
import { createWorkspace } from "../server/workspaces";
import { workspacesCollection } from "../workspaces-collection";

const root = getRouteApi("__root__");

/** First sign-in, or "New workspace": name the workspace and pick its slug. */
export const Route = createFileRoute("/welcome")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/sign-in" });
  },
  component: Welcome,
});

function Welcome() {
  const me = root.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!me) return null;
  const effectiveSlug = slugEdited ? slug : slugOf(name);
  const first = me.workspaces.length === 0;
  const create = async () => {
    if (creating || !name.trim() || !validSlug(effectiveSlug)) return;
    setCreating(true);
    const result = await createWorkspace({ data: { name, slug: effectiveSlug } });
    setCreating(false);
    if (!result.ok) {
      setMessage(
        result.reason === "conflict"
          ? "That slug is already taken. Choose another."
          : `Could not create the workspace (${result.reason}).`,
      );
      return;
    }
    void workspacesCollection().utils.refetch();
    await router.invalidate();
    await router.navigate({ to: "/$slug", params: { slug: result.value.slug } });
  };
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <form
        className="flex w-full max-w-sm flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">
            {first ? `Welcome, ${me.user.name}` : "New workspace"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {first
              ? "Name your team's workspace. You can invite others once it exists."
              : "Each workspace has its own members, channels and settings."}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Workspace name</Label>
          <Input
            id="name"
            value={name}
            maxLength={80}
            autoFocus
            placeholder="Acme"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">Slug</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">notus.run/</span>
            <Input
              id="slug"
              className="font-mono"
              value={effectiveSlug}
              placeholder="acme"
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.target.value.toLowerCase());
              }}
            />
          </div>
          {effectiveSlug && !validSlug(effectiveSlug) ? (
            <p className="text-destructive text-xs">
              Lowercase letters, digits and dashes, 2 to 48 characters.
            </p>
          ) : null}
        </div>
        {message ? <p className="text-destructive text-sm">{message}</p> : null}
        <Button type="submit" disabled={creating || !name.trim() || !validSlug(effectiveSlug)}>
          Create workspace
        </Button>
      </form>
    </main>
  );
}
