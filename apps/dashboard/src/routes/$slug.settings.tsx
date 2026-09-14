import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validSlug } from "../lib/slug";
import { updateWorkspace } from "../server/workspaces";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/settings")({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (parent.loaderData && parent.loaderData.role !== "admin")
      throw redirect({ to: "/$slug", params });
  },
  component: Settings,
});

function Settings() {
  const { me, view, current } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState(view.workspace.name);
  const [slug, setSlug] = useState(view.workspace.slug);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const dirty = name.trim() !== view.workspace.name || slug !== view.workspace.slug;
  const save = async () => {
    if (saving || !dirty || !name.trim() || !validSlug(slug)) return;
    setSaving(true);
    const result = await updateWorkspace({ data: { workspaceId: view.workspace.id, name, slug } });
    setSaving(false);
    if (!result.ok) {
      setMessage(
        result.reason === "conflict"
          ? "That slug is already taken."
          : `That did not work (${result.reason}).`,
      );
      return;
    }
    setMessage(null);
    await router.invalidate();
    // A new slug means a new address for every page of this workspace.
    if (result.value.slug !== view.workspace.slug)
      await router.navigate({ to: "/$slug/settings", params: { slug: result.value.slug } });
  };
  return (
    <AppShell me={me} current={current} active="settings" title="Settings">
      <form
        className="flex max-w-md flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            maxLength={80}
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
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Changing the slug changes every link to this workspace.
          </p>
          {slug && !validSlug(slug) ? (
            <p className="text-destructive text-xs">
              Lowercase letters, digits and dashes, 2 to 48 characters.
            </p>
          ) : null}
        </div>
        {message ? <p className="text-destructive text-sm">{message}</p> : null}
        <div>
          <Button type="submit" disabled={saving || !dirty || !name.trim() || !validSlug(slug)}>
            Save
          </Button>
        </div>
      </form>
    </AppShell>
  );
}
