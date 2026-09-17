import { IconHistory } from "@tabler/icons-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  changes,
  configOf,
  fieldsOf,
  labelOf,
  problemOf,
  type Fields,
} from "../devbox/namespace/fields";
import { NamespaceForm } from "../devbox/namespace/form";
import { WorkspaceImages } from "../devbox/namespace/images";
import { NamespaceMark } from "../devbox/namespace/mark";
import { canonical } from "../lib/json";
import {
  addImage,
  environmentHistory,
  getEnvironment,
  removeImage,
  saveEnvironment,
  type EnvironmentRevision,
} from "../server/devbox";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/devbox")({
  staticData: {
    shell: {
      active: "devbox",
      title: "Devbox",
      description: "The machine every task runs on.",
    },
  },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return { environment: null, approvedImages: [], workspaceImages: [] };
    const result = await getEnvironment({
      data: { workspaceId: parent.loaderData.workspace.id },
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  },
  component: Devbox,
});

const when = (millis: number) =>
  new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * One card per provider, of which there is one: Namespace. The card shows the configuration as
 * fields; saving is a revision, and the history lists what each revision changed.
 */
function Devbox() {
  const { view } = useWorkspace();
  const { environment, approvedImages, workspaceImages } = Route.useLoaderData();
  const router = useRouter();
  const isAdmin = view.role === "admin";
  // The unsaved fields, and a revision opened from the history to be put back.
  const [draft, setDraft] = useState<Fields | null>(null);
  const [opened, setOpened] = useState<{ revision: number; fields: Fields } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<EnvironmentRevision> | null>(null);
  const stored = environment?.config;
  // A workspace that was never configured starts from the image the deployment approves.
  const current = fieldsOf(stored);
  const fields =
    draft ??
    opened?.fields ??
    (current.imageRef === "" && approvedImages[0] !== undefined
      ? { ...current, imageRef: approvedImages[0] }
      : current);
  const config = configOf(fields);
  const problem = problemOf(fields);
  const dirty = canonical(config) !== canonical(stored);
  const nameOf = (userId: string | null) =>
    userId === null
      ? "the deployment"
      : (view.members.find((m) => m.userId === userId)?.name ?? "someone");
  const edit = (change: Partial<Fields>) => setDraft({ ...fields, ...change });
  const save = async () => {
    if (saving || !dirty || problem !== null) return;
    setSaving(true);
    const result = await saveEnvironment({ data: { workspaceId: view.workspace.id, config } });
    if (!result.ok) {
      setSaving(false);
      setMessage(result.reason);
      return;
    }
    await router.invalidate();
    setDraft(null);
    setOpened(null);
    setSaving(false);
    setMessage(null);
  };
  // The list the select offers comes back with the page, so a change reloads it.
  const changeImages = async (result: { ok: true } | { ok: false; reason: string }) => {
    if (!result.ok) return result.reason;
    await router.invalidate();
    return null;
  };
  const openHistory = async () => {
    const result = await environmentHistory({ data: { workspaceId: view.workspace.id } });
    if (!result.ok) {
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    setHistory(result.value);
  };
  const open = (revision: EnvironmentRevision) => {
    setOpened({ revision: revision.revision, fields: fieldsOf(revision.config) });
    setDraft(null);
    setHistory(null);
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NamespaceMark className="text-muted-foreground size-5" />
            Namespace
          </CardTitle>
          <CardDescription className="text-pretty">
            Every task starts a Namespace devbox from this configuration. A change applies to tasks
            started after it is saved.
          </CardDescription>
          {/* Configuration state: a dot beside the revision that tasks start from. */}
          <CardAction className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className={
                environment
                  ? "size-1.5 rounded-full bg-emerald-500"
                  : "size-1.5 rounded-full bg-muted-foreground/40"
              }
            />
            {environment ? `Revision ${environment.revision}` : "Not configured"}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {opened ? (
            <p className="text-muted-foreground text-xs">
              Showing revision {opened.revision}; saving makes it current.
            </p>
          ) : null}
          <NamespaceForm
            fields={fields}
            approvedImages={approvedImages}
            disabled={!isAdmin}
            onChange={edit}
          />
          {message ? <p className="text-destructive text-sm">{message}</p> : null}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <div>
            {environment ? (
              <Button variant="ghost" size="sm" onClick={openHistory}>
                <IconHistory className="size-4" />
                History
              </Button>
            ) : null}
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-3">
              {dirty && problem ? (
                <span className="text-muted-foreground text-xs">{problem}</span>
              ) : null}
              <Button size="sm" disabled={saving || !dirty || problem !== null} onClick={save}>
                {saving ? "Saving" : "Save"}
              </Button>
            </div>
          ) : null}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your images</CardTitle>
          <CardDescription className="text-pretty">
            Images this workspace approves beside the ones the deployment offers. Build yours from
            the Notus base image, publish it, and add its digest; it then appears in the image field
            above. Notus does not inspect it: whoever adds an image vouches for what it contains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceImages
            images={workspaceImages}
            selected={fieldsOf(stored).imageRef}
            disabled={!isAdmin}
            nameOf={nameOf}
            onAdd={async (ref, label) =>
              changeImages(await addImage({ data: { workspaceId: view.workspace.id, ref, label } }))
            }
            onRemove={async (ref) =>
              changeImages(await removeImage({ data: { workspaceId: view.workspace.id, ref } }))
            }
          />
        </CardContent>
      </Card>
      <Sheet
        open={history !== null}
        onOpenChange={(isOpen) => (isOpen ? undefined : setHistory(null))}
      >
        <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="px-6 pt-6 pb-4">
            <SheetTitle>History</SheetTitle>
            <SheetDescription>
              Every save is a revision, listed with what it changed. Open one to see it in the
              fields; saving makes it current.
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col divide-y divide-foreground/10 border-t border-foreground/10">
            {(history ?? []).map((revision, index, all) => {
              // Newest first, so the one before it in time is the next in the list.
              const previous = all[index + 1];
              const changed = changes(previous?.config, revision.config);
              return (
                <li key={revision.revision} className="flex flex-col gap-2 px-6 py-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">Revision {revision.revision}</span>
                      {revision.revision === environment?.revision ? (
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
                  {changed.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {previous ? "Saved unchanged." : "The first revision."}
                    </p>
                  ) : (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {changed.map((change) => (
                        <div key={change.path} className="contents">
                          <dt className="text-muted-foreground">{labelOf(change.path)}</dt>
                          <dd className="min-w-0 truncate">
                            {change.before !== null ? (
                              <span className="text-muted-foreground line-through">
                                {change.before}
                              </span>
                            ) : null}
                            {change.before !== null && change.after !== null ? " " : null}
                            {change.after !== null ? change.after : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
