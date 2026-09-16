import { IconHistory, IconInfoCircle, IconPlus, IconTrash } from "@tabler/icons-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteRole, listRoles, roleHistory, saveRole, type RevisionRow } from "../server/roles";
import { useTheme } from "../theme";
import { useWorkspace } from "./$slug";

const roleNamePattern = /^[a-z][a-z0-9_-]{0,31}$/;
/** The role's id from the name typed: "Code reviewer" becomes code-reviewer. */
const idOf = (display: string) =>
  display
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export const Route = createFileRoute("/$slug/specialists")({
  staticData: {
    shell: {
      active: "specialists",
      title: "Specialists",
      description:
        "Specialists are goal oriented agents the operator uses to write or review code.",
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
  component: Specialists,
});

/** `qa` reads as QA, `code-reviewer` as Code reviewer. */
const labelOf = (name: string) => {
  const words = name.split(/[-_]+/).filter((word) => word !== "");
  if (words.length === 1 && name.length <= 3) return name.toUpperCase();
  return words
    .map((word, i) => (i === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(" ");
};
const when = (millis: number) =>
  new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

type Draft = { name: string; summary: string; markdown: string };

function Specialists() {
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
  // The unsaved text for the selected role, and a revision opened from the history.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opened, setOpened] = useState<{
    name: string;
    revision: number;
    summary: string;
    body: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<RevisionRow> | null>(null);
  const editing = draft?.name === selectedName ? draft : null;
  const revisionOpen = opened?.name === selectedName ? opened : null;
  const base = revisionOpen ?? current;
  const summary = editing?.summary ?? base?.summary ?? "";
  const markdown = editing?.markdown ?? base?.body ?? "";
  const dirty = summary !== (current?.summary ?? "") || markdown !== (current?.body ?? "");
  const nameOf = (userId: string) =>
    view.members.find((m) => m.userId === userId)?.name ?? "someone";
  const edit = (change: Partial<Draft>) => {
    if (selectedName === null) return;
    setDraft({ name: selectedName, summary, markdown, ...change });
  };

  const select = (name: string) => {
    setCreating(null);
    setConfirmDelete(false);
    setMessage(null);
    void navigate({ search: { role: name } });
  };
  const save = async () => {
    if (selectedName === null || saving) return;
    setSaving(true);
    const result = await saveRole({
      data: { workspaceId: view.workspace.id, name: selectedName, summary, body: markdown },
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
    setOpened({
      name: selectedName,
      revision: revision.revision,
      summary: revision.summary,
      body: revision.body,
    });
    setDraft(null);
    setHistory(null);
  };
  const confirmName = () => {
    if (!creating) return;
    const name = idOf(creating.name);
    if (!roleNamePattern.test(name)) return;
    if (roles.some((role) => role.name === name)) select(name);
    else setCreating({ name, named: true });
  };
  // The editor is keyed so switching roles, or opening a revision, starts it afresh.
  const editorKey =
    selectedName === null
      ? null
      : `${selectedName}:${revisionOpen ? `r${revisionOpen.revision}` : "current"}`;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={selectedName ?? ""}
            onValueChange={(value) => {
              if (typeof value === "string" && value !== "") select(value);
            }}
          >
            <TabsList>
              {roles.map((role) => (
                <TabsTrigger key={role.name} value={role.name} className="px-3">
                  {labelOf(role.name)}
                </TabsTrigger>
              ))}
              {creating?.named ? (
                <TabsTrigger value={creating.name} className="px-3">
                  {labelOf(creating.name)}
                </TabsTrigger>
              ) : null}
            </TabsList>
          </Tabs>
          {isAdmin && !creating ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreating({ name: "", named: false })}
            >
              <IconPlus className="size-4" />
              New role
            </Button>
          ) : null}
          {creating && !creating.named ? (
            // The button becomes the field: the name as it will read, Enter to add, Escape to drop.
            <Input
              autoFocus
              className="w-56"
              placeholder="Role name"
              aria-label="New role name"
              value={creating.name}
              onChange={(event) => setCreating({ name: event.target.value, named: false })}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(null);
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmName();
                }
              }}
              onBlur={() => {
                if (creating.name.trim() === "") setCreating(null);
              }}
            />
          ) : null}
        </div>
        {selectedName !== null && editorKey !== null ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="role-summary">Role</Label>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="What the role is for"
                      />
                    }
                  >
                    <IconInfoCircle className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    One line the operator reads when choosing which specialist to run. The
                    instructions below are given to the specialist itself.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="role-summary"
                value={summary}
                maxLength={200}
                readOnly={!isAdmin}
                placeholder="What this specialist does, in one line"
                onChange={(event) => edit({ summary: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Label>Instructions</Label>
                {revisionOpen ? (
                  <span className="text-muted-foreground text-xs">
                    Showing revision {revisionOpen.revision}; saving makes it current.
                  </span>
                ) : null}
              </div>
              <MarkdownEditor
                key={editorKey}
                markdown={base?.body ?? ""}
                editable={isAdmin}
                theme={theme === "system" ? resolvedTheme() : theme}
                placeholder="How this specialist should work, and what to report."
                onChange={(next) => edit({ markdown: next })}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {current ? (
                    <Button variant="ghost" size="sm" onClick={openHistory}>
                      <IconHistory className="size-4" />
                      History
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
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
                    <Button
                      size="sm"
                      disabled={saving || (!dirty && current !== null)}
                      onClick={save}
                    >
                      {saving ? "Saving" : current ? "Save" : "Create role"}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
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
              <SheetTitle>History of {current ? labelOf(current.name) : ""}</SheetTitle>
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
                  {revision.summary ? <p className="text-xs">{revision.summary}</p> : null}
                  <p className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-wrap">
                    {revision.body}
                  </p>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

/** The page runs client-side only, so the document's class is the theme actually shown. */
const resolvedTheme = (): "light" | "dark" =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
