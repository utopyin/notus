import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validSlug } from "../lib/slug";
import { workspacesCollection } from "../workspaces-collection";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/settings")({
  staticData: { shell: { active: "settings", title: "Settings" } },
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (parent.loaderData && parent.loaderData.role !== "admin")
      throw redirect({ to: "/$slug", params });
  },
  component: Settings,
});

function Settings() {
  const { view } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState(view.workspace.name);
  const [slug, setSlug] = useState(view.workspace.slug);
  // What the form last saved. Comparing against this, not the page data that refreshes later,
  // keeps the button from flickering between a save and the refresh.
  const [saved, setSaved] = useState({ name: view.workspace.name, slug: view.workspace.slug });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== saved.name || slug !== saved.slug;
  const save = async () => {
    if (saving || !dirty || !name.trim() || !validSlug(slug)) return;
    setSaving(true);
    // Optimistic through the shared collection: the sidebar updates at once, and rolls back on refusal.
    const tx = workspacesCollection().update(view.workspace.id, (draft) => {
      draft.name = name.trim();
      draft.slug = slug;
    });
    try {
      await tx.isPersisted.promise;
    } catch (error) {
      setSaving(false);
      const reason = error instanceof Error ? error.message : "failed";
      setMessage(
        reason === "conflict" ? "That slug is already taken." : `That did not work (${reason}).`,
      );
      return;
    }
    setMessage(null);
    setSaved({ name: name.trim(), slug });
    setSaving(false);
    await router.invalidate();
    // A new slug means a new address for every page of this workspace.
    if (slug !== view.workspace.slug)
      await router.navigate({ to: "/$slug/settings", params: { slug } });
  };
  return (
    <>
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
    </>
  );
}
