import { IconHistory, IconPlus, IconTrash } from "@tabler/icons-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteRole, listRoles, roleHistory, saveRole, type RevisionRow } from "../server/roles";
import { useTheme } from "../theme";
import { useWorkspace } from "./$slug";

const roleNamePattern = /^[a-z][a-z0-9_-]{0,31}$/;

export const Route = createFileRoute("/$slug/instructions")({
  staticData: {
    shell: {
      active: "instructions",
      title: "Instructions",
      description: "The roles a specialist can be given. Each opens the agent's instructions.",
    },
  },
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { role?: string } => ({
    role: typeof search.role === "string" ? search.role : undefined,
  }),
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return [];
    const result = await listRoles({ data: { workspaceId: parent.loaderData.workspace.id } });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  },
  component: Instructions,
});

const when = (millis: number) =>
  new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Instructions() {
  const { view } = useWorkspace();
  const roles = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const theme = useTheme();
  const isAdmin = view.role === "admin";
  // A role being created lives only here until its first save: first its name, then its text.
  const [creating, setCreating] = useState<{ name: string; named: boolean } | null>(null);
  const selectedName = creating?.named
    ? creating.name
    : search.role && roles.some((role) => role.name === search.role)
      ? search.role
      : (roles[0]?.name ?? null);
  const current = roles.find((role) => role.name === selectedName) ?? null;
  // The editor's unsaved text for the selected role, and a revision opened from the history.
  const [draft, setDraft] = useState<{ name: string; markdown: string } | null>(null);
  const [opened, setOpened] = useState<{ name: string; revision: number; body: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<RevisionRow> | null>(null);
  const editing = draft?.name === selectedName ? draft.markdown : null;
  const revisionOpen = opened?.name === selectedName ? opened : null;
  const savedBody = current?.body ?? "";
  const dirty =
    editing !== null
      ? editing !== savedBody
      : revisionOpen !== null
        ? revisionOpen.body !== savedBody
        : false;
  const nameOf = (userId: string) =>
    view.members.find((m) => m.userId === userId)?.name ?? "someone";

  const select = (name: string) => {
    setCreating(null);
    setConfirmDelete(false);
    setMessage(null);
    void navigate({ search: { role: name } });
  };
  const save = async () => {
    if (selectedName === null || saving) return;
    const body = editing ?? revisionOpen?.body ?? savedBody;
    setSaving(true);
    const result = await saveRole({
      data: { workspaceId: view.workspace.id, name: selectedName, body },
    });
    if (!result.ok) {
      setSaving(false);
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    await router.invalidate();
    setDraft(null);
    setOpened(null);
    setSaving(false);
    setMessage(null);
    if (creating) {
      setCreating(null);
      void navigate({ search: { role: selectedName } });
    }
  };
  const remove = async () => {
    if (!current || saving) return;
    setSaving(true);
    const result = await deleteRole({
      data: { workspaceId: view.workspace.id, name: current.name },
    });
    setSaving(false);
    setConfirmDelete(false);
    if (!result.ok) {
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    await router.invalidate();
    setDraft(null);
    setOpened(null);
    void navigate({ search: {} });
  };
  const openHistory = async () => {
    if (!current) return;
    const result = await roleHistory({
      data: { workspaceId: view.workspace.id, name: current.name },
    });
    if (!result.ok) {
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    setHistory(result.value);
  };
  const open = (revision: RevisionRow) => {
    if (selectedName === null) return;
    setOpened({ name: selectedName, revision: revision.revision, body: revision.body });
    setDraft(null);
    setHistory(null);
  };
  const confirmName = () => {
    if (!creating) return;
    const name = creating.name.trim();
    if (!roleNamePattern.test(name)) return;
    if (roles.some((role) => role.name === name)) select(name);
    else setCreating({ name, named: true });
  };
  const validNewName = creating ? roleNamePattern.test(creating.name.trim()) : false;
  // The editor is keyed so switching roles, or opening a revision, starts it afresh.
  const editorKey =
    selectedName === null
      ? null
      : `${selectedName}:${revisionOpen ? `r${revisionOpen.revision}` : "current"}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={selectedName ?? ""}
          onValueChange={(value) => {
            if (typeof value === "string" && value !== "") select(value);
          }}
        >
          <TabsList>
            {roles.map((role) => (
              <TabsTrigger key={role.name} value={role.name} className="px-3">
                {role.name}
              </TabsTrigger>
            ))}
            {creating?.named ? (
              <TabsTrigger value={creating.name} className="px-3">
                {creating.name}
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
        {isAdmin && !creating ? (
          <Button variant="ghost" size="sm" onClick={() => setCreating({ name: "", named: false })}>
            <IconPlus className="size-4" />
            New role
          </Button>
        ) : null}
        {creating && !creating.named ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              confirmName();
            }}
          >
            <Input
              autoFocus
              className="w-48 font-mono text-sm"
              placeholder="role-name"
              value={creating.name}
              onChange={(event) =>
                setCreating({ name: event.target.value.toLowerCase(), named: false })
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(null);
              }}
            />
            <Button type="submit" size="sm" disabled={!validNewName}>
              Add
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(null)}>
              Cancel
            </Button>
          </form>
        ) : null}
      </div>
      {selectedName !== null && editorKey !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground min-w-0 flex-1 text-sm">
              {revisionOpen
                ? `Showing revision ${revisionOpen.revision} of ${revisionOpen.name}. Saving makes it the current text.`
                : current
                  ? `Revision ${current.revision}, saved by ${nameOf(current.authorId)} on ${when(current.updatedAt)}. The first line is what the operator reads when choosing a role.`
                  : "A new role. Its first line is what the operator reads when choosing a role."}
            </p>
            {current ? (
              <Button variant="ghost" size="sm" onClick={openHistory}>
                <IconHistory className="size-4" />
                History
              </Button>
            ) : null}
            {isAdmin && current ? (
              confirmDelete ? (
                <Button variant="destructive" size="sm" disabled={saving} onClick={remove}>
                  Confirm delete
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <IconTrash className="size-4" />
                  Delete
                </Button>
              )
            ) : null}
            {isAdmin ? (
              <Button size="sm" disabled={saving || (!dirty && current !== null)} onClick={save}>
                {saving ? "Saving" : current ? "Save" : "Create role"}
              </Button>
            ) : null}
          </div>
          <MarkdownEditor
            key={editorKey}
            markdown={revisionOpen ? revisionOpen.body : savedBody}
            editable={isAdmin}
            theme={theme === "system" ? resolvedTheme() : theme}
            placeholder="Start with one line that says what this role does, then how it should work and what to report."
            onChange={(markdown) => setDraft({ name: selectedName, markdown })}
          />
          {message ? <p className="text-destructive text-sm">{message}</p> : null}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          No roles yet. Specialists run on the operator's instructions alone until one is added.
        </p>
      )}
      <Sheet
        open={history !== null}
        onOpenChange={(isOpen) => (isOpen ? undefined : setHistory(null))}
      >
        <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="px-6 pt-6 pb-4">
            <SheetTitle>History of {current?.name}</SheetTitle>
            <SheetDescription>
              Every save is a revision. Open one to see it in the editor; saving makes it current.
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col divide-y divide-foreground/10 border-t border-foreground/10">
            {(history ?? []).map((revision) => (
              <li key={revision.revision} className="flex flex-col gap-2 px-6 py-4 text-sm">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">Revision {revision.revision}</span>
                    {revision.revision === current?.revision ? (
                      <span className="text-muted-foreground"> (current)</span>
                    ) : null}
                    <span className="text-muted-foreground block truncate text-xs">
                      {nameOf(revision.authorId)}, {when(revision.createdAt)}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => open(revision)}>
                    Open
                  </Button>
                </div>
                <p className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-wrap">
                  {revision.body}
                </p>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The page runs client-side only, so the document's class is the theme actually shown. */
const resolvedTheme = (): "light" | "dark" =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
