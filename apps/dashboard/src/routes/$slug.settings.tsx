import { createFileRoute, useRouter } from "@tanstack/react-router";
import { zone } from "@notus/shared/hosts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InvitesSection } from "@/components/invites-section";
import { MembersSection } from "@/components/members-section";
import { collectionsOf } from "../collections";
import { validSlug } from "../lib/slug";
import { workspacesCollection } from "../workspaces-collection";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/settings")({
  staticData: { shell: { active: "settings", title: "Settings" } },
  // The invites list is a TanStack DB collection, which renders on the client only.
  ssr: false,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData || parent.loaderData.role !== "admin") return;
    await collectionsOf(parent.loaderData.workspace.id).invites.preload();
  },
  component: Settings,
});

/** One page in sections: the workspace's name and address (admins), its members, and invites (admins). */
function Settings() {
  const { view } = useWorkspace();
  const isAdmin = view.role === "admin";
  return (
    <div className="flex flex-col gap-8">
      {isAdmin ? <WorkspaceForm /> : null}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">Members</h2>
        <MembersSection />
      </section>
      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <InvitesSection />
        </section>
      ) : null}
    </div>
  );
}

function WorkspaceForm() {
  const { view } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState(view.workspace.name);
  const [slug, setSlug] = useState(view.workspace.slug);
  // What the form last saved. Comparing against this keeps the button from flickering while the
  // page data refreshes after a save.
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
          <div className="relative">
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-base md:text-sm"
            >
              {zone}/
            </span>
            <Input
              id="slug"
              className="pl-[8.5ch]"
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
