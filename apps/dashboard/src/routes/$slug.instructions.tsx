import {
  IconBookFilled,
  IconBrandGithubFilled,
  IconHistory,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  deleteInstruction,
  instructionHistory,
  listInstructions,
  saveInstruction,
  type InstructionKind,
  type InstructionRow,
  type RevisionRow,
} from "../server/instructions";
import { useTheme } from "../theme";
import { useWorkspace } from "./$slug";

type Selection = { kind: InstructionKind; name: string };
const roleNamePattern = /^[a-z][a-z0-9_-]{0,31}$/;
const docKey = (selection: Selection) => `${selection.kind}:${selection.name}`;

export const Route = createFileRoute("/$slug/instructions")({
  staticData: {
    shell: {
      active: "instructions",
      title: "Instructions",
      description: "What specialists follow: their roles, and each repository's conventions.",
    },
  },
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Partial<Selection> => ({
    kind: search.kind === "repository" ? "repository" : search.kind === "role" ? "role" : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
  }),
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return [];
    const result = await listInstructions({
      data: { workspaceId: parent.loaderData.workspace.id },
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  },
  component: Instructions,
});

const summaryOf = (body: string) =>
  body
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim() ?? "";

function Instructions() {
  const { view } = useWorkspace();
  const rows = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const theme = useTheme();
  const isAdmin = view.role === "admin";
  const roles = rows.filter((row) => row.kind === "role");
  const overrides = rows.filter((row) => row.kind === "repository");
  // Every covered GitHub repository can have conventions, whether or not it has some yet.
  const repositories = [
    ...new Set([
      ...view.scopes.filter((scope) => scope.platform === "github").map((scope) => scope.scope),
      ...overrides.map((row) => row.name),
    ]),
  ].sort();
  // A role being created lives only here until its first save.
  const [creating, setCreating] = useState<{ name: string; open: boolean } | null>(null);
  const selected: Selection | null =
    creating && !creating.open
      ? { kind: "role", name: creating.name }
      : search.kind && search.name
        ? { kind: search.kind, name: search.name }
        : roles[0]
          ? { kind: "role", name: roles[0].name }
          : repositories[0]
            ? { kind: "repository", name: repositories[0] }
            : null;
  const current =
    selected === null
      ? null
      : (rows.find((row) => row.kind === selected.kind && row.name === selected.name) ?? null);
  // The editor's unsaved text for the selected document, and a restored revision to open instead.
  const [draft, setDraft] = useState<{ key: string; markdown: string } | null>(null);
  const [restored, setRestored] = useState<{ key: string; revision: number; body: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<{ key: string; rows: ReadonlyArray<RevisionRow> } | null>(
    null,
  );
  const key = selected ? docKey(selected) : null;
  const savedBody = current?.body ?? "";
  const editing = draft?.key === key ? draft.markdown : null;
  const opened = restored?.key === key ? restored : null;
  const dirty =
    editing !== null ? editing !== savedBody : opened !== null ? opened.body !== savedBody : false;
  const nameOf = (userId: string) =>
    view.members.find((m) => m.userId === userId)?.name ?? "someone";

  const select = (next: Selection) => {
    setCreating(null);
    setConfirmDelete(false);
    setMessage(null);
    void navigate({ search: next });
  };
  const save = async () => {
    if (!selected || saving) return;
    const body = editing ?? opened?.body ?? savedBody;
    setSaving(true);
    const result = await saveInstruction({
      data: { workspaceId: view.workspace.id, kind: selected.kind, name: selected.name, body },
    });
    if (!result.ok) {
      setSaving(false);
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    await router.invalidate();
    setDraft(null);
    setRestored(null);
    setSaving(false);
    setMessage(null);
    if (creating) {
      setCreating(null);
      void navigate({ search: selected });
    }
  };
  const remove = async () => {
    if (!selected || !current || saving) return;
    setSaving(true);
    const result = await deleteInstruction({
      data: { workspaceId: view.workspace.id, kind: selected.kind, name: selected.name },
    });
    setSaving(false);
    setConfirmDelete(false);
    if (!result.ok) {
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    await router.invalidate();
    setDraft(null);
    setRestored(null);
    if (selected.kind === "role") void navigate({ search: {} });
  };
  const openHistory = async () => {
    if (!selected || !key) return;
    const result = await instructionHistory({
      data: { workspaceId: view.workspace.id, kind: selected.kind, name: selected.name },
    });
    if (!result.ok) {
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    setHistory({ key, rows: result.value });
  };
  const restore = (revision: RevisionRow) => {
    if (!key) return;
    setRestored({ key, revision: revision.revision, body: revision.body });
    setDraft(null);
    setHistory(null);
  };
  const startCreating = () => {
    setConfirmDelete(false);
    setMessage(null);
    setCreating({ name: "", open: true });
  };
  const confirmCreating = () => {
    if (!creating) return;
    const name = creating.name.trim();
    if (!roleNamePattern.test(name)) return;
    if (roles.some((role) => role.name === name)) {
      select({ kind: "role", name });
      return;
    }
    setCreating({ name, open: false });
  };
  const validNewName = creating ? roleNamePattern.test(creating.name.trim()) : false;
  // The editor is keyed so switching documents, or opening a revision, starts it afresh.
  const editorKey = key ? `${key}:${opened ? `r${opened.revision}` : "current"}` : null;
  const initial = opened ? opened.body : savedBody;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-64">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Roles
            </h2>
            {isAdmin ? (
              <Button variant="ghost" size="sm" onClick={startCreating} aria-label="New role">
                <IconPlus className="size-4" />
                New
              </Button>
            ) : null}
          </div>
          {creating?.open ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                confirmCreating();
              }}
            >
              <Input
                autoFocus
                className="font-mono text-sm"
                placeholder="role-name"
                value={creating.name}
                onChange={(event) =>
                  setCreating({ name: event.target.value.toLowerCase(), open: true })
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCreating(null);
                }}
              />
              <Button type="submit" size="sm" disabled={!validNewName}>
                Add
              </Button>
            </form>
          ) : null}
          <ul className="bg-card flex flex-col divide-y divide-foreground/10 rounded-lg ring-1 ring-foreground/10">
            {roles.map((role) => (
              <li key={role.name}>
                <DocumentButton
                  active={selected?.kind === "role" && selected.name === role.name}
                  icon={<IconBookFilled className="size-4" />}
                  title={role.name}
                  subtitle={summaryOf(role.body) || "No description yet"}
                  badge={`r${role.revision}`}
                  onClick={() => select({ kind: "role", name: role.name })}
                />
              </li>
            ))}
            {creating && !creating.open ? (
              <li>
                <DocumentButton
                  active
                  icon={<IconBookFilled className="size-4" />}
                  title={creating.name}
                  subtitle="Not saved yet"
                  badge="new"
                  onClick={() => undefined}
                />
              </li>
            ) : null}
            {roles.length === 0 && !creating ? (
              <li className="text-muted-foreground px-3 py-3 text-sm">
                No roles. Specialists run on the operator's instructions alone.
              </li>
            ) : null}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Repositories
          </h2>
          <ul className="bg-card flex flex-col divide-y divide-foreground/10 rounded-lg ring-1 ring-foreground/10">
            {repositories.map((fullName) => {
              const override = overrides.find((row) => row.name === fullName);
              return (
                <li key={fullName}>
                  <DocumentButton
                    active={selected?.kind === "repository" && selected.name === fullName}
                    icon={<IconBrandGithubFilled className="size-4" />}
                    title={fullName}
                    subtitle={
                      override ? summaryOf(override.body) || "Conventions" : "No conventions yet"
                    }
                    badge={override ? `r${override.revision}` : null}
                    onClick={() => select({ kind: "repository", name: fullName })}
                  />
                </li>
              );
            })}
            {repositories.length === 0 ? (
              <li className="text-muted-foreground px-3 py-3 text-sm">
                Cover a GitHub repository under Platforms to write its conventions.
              </li>
            ) : null}
          </ul>
        </section>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        {selected && editorKey ? (
          <>
            <header className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="truncate font-medium">
                  {selected.kind === "role" ? `Role: ${selected.name}` : selected.name}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {opened
                    ? `Showing revision ${opened.revision}; save to make it the current text.`
                    : current
                      ? `Revision ${current.revision}, saved by ${nameOf(current.authorId)} on ${new Date(current.updatedAt).toLocaleString()}.`
                      : selected.kind === "role"
                        ? "A new role. Its first line is what the operator reads when choosing a role."
                        : "No conventions yet. Whatever you write here is given to every specialist working in this repository."}
                </p>
              </div>
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
                  {saving ? "Saving" : current ? "Save revision" : "Create"}
                </Button>
              ) : null}
            </header>
            <MarkdownEditor
              key={editorKey}
              markdown={initial}
              editable={isAdmin}
              theme={theme === "system" ? resolvedTheme() : theme}
              placeholder={
                selected.kind === "role"
                  ? "Start with one line that says what this role does, then how it should work and what to report."
                  : "Conventions for this repository: how to run its checks, what to never touch, how it is laid out."
              }
              onChange={(markdown) => {
                if (key) setDraft({ key, markdown });
              }}
            />
            {message ? <p className="text-destructive text-sm">{message}</p> : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Pick a role or a repository.</p>
        )}
      </section>
      <Sheet open={history !== null} onOpenChange={(open) => (open ? undefined : setHistory(null))}>
        <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>History</SheetTitle>
            <SheetDescription>
              Every save is a revision. Opening one shows it in the editor; saving makes it current.
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col divide-y divide-foreground/10">
            {(history?.rows ?? []).map((revision) => (
              <li key={revision.revision} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={revision.revision === current?.revision ? "default" : "secondary"}
                  >
                    r{revision.revision}
                  </Badge>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {nameOf(revision.authorId)}, {new Date(revision.createdAt).toLocaleString()}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => restore(revision)}>
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

function DocumentButton(props: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-active={props.active || undefined}
      className="hover:bg-accent/60 data-[active]:bg-accent flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm first:rounded-t-lg last:rounded-b-lg"
    >
      <span className="text-muted-foreground shrink-0">{props.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{props.title}</span>
        <span className="text-muted-foreground truncate text-xs">{props.subtitle}</span>
      </span>
      {props.badge ? (
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          {props.badge}
        </Badge>
      ) : null}
    </button>
  );
}

export type { InstructionRow };
