import { IconHistory } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
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
import { canonical } from "../lib/json";
import { useWorkspace } from "../routes/$slug";
import {
  addImage,
  buildTemplate,
  connectCompute,
  disconnectCompute,
  environmentHistory,
  removeImage,
  saveEnvironment,
  setDefaultImage,
  type EnvironmentRevision,
  type EnvironmentView,
} from "../server/devbox";
import { ComputeConnection } from "./connection";
import { changes, type Kit } from "./kit";
import { TemplateBuild, WorkspaceTemplates } from "./templates";

const when = (millis: number) =>
  new Date(millis).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * One provider's cards: the workspace's account with it, its configuration as the provider's own
 * fields, and the templates its admins added. Saving is a revision, and the history lists what
 * each revision changed.
 */
export function ProviderPage<F>({ kit, data }: { kit: Kit<F>; data: EnvironmentView }) {
  const { view } = useWorkspace();
  const { descriptor } = kit;
  const provider = descriptor.provider;
  const { approvedImages, workspaceImages, defaultImage, connection, build } = data;
  const builds = descriptor.capabilities.has("template:build");
  // Another provider's configuration leaves the card empty; saving switches the workspace over.
  const environment = data.environment?.provider === provider ? data.environment : null;
  const runsElsewhere = data.environment !== null && environment === null;
  const router = useRouter();
  const isAdmin = view.role === "admin";
  // The unsaved fields, and a revision opened from the history to be put back.
  const [draft, setDraft] = useState<F | null>(null);
  const [opened, setOpened] = useState<{ revision: number; fields: F } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<EnvironmentRevision> | null>(null);
  const stored = environment?.config;
  // The reloaded page lands in a transition, later than a state update made after the save. So the
  // draft is dropped in the render the new revision arrives in, never before it: clearing it on
  // the save's return would show the stored values once more.
  const revision = environment?.revision ?? null;
  const [seen, setSeen] = useState(revision);
  if (seen !== revision) {
    setSeen(revision);
    setDraft(null);
    setOpened(null);
    setSaving(false);
  }
  // A workspace that was never configured starts from its default image, if it has one.
  const current = kit.fieldsOf(stored);
  const fields =
    draft ??
    opened?.fields ??
    (kit.templateOf(current) === "" && defaultImage !== null
      ? kit.withTemplate(current, defaultImage)
      : current);
  const config = kit.configOf(fields);
  const problem = kit.problemOf(fields);
  const dirty = canonical(config) !== canonical(stored);
  const nameOf = (userId: string | null) =>
    userId === null
      ? "the deployment"
      : (view.members.find((m) => m.userId === userId)?.name ?? "someone");
  const edit = (change: Partial<F>) => setDraft({ ...fields, ...change });
  const save = async () => {
    if (saving || !dirty || problem !== null) return;
    setSaving(true);
    const result = await saveEnvironment({
      data: { workspaceId: view.workspace.id, provider, config },
    });
    if (!result.ok) {
      setSaving(false);
      setMessage(result.reason);
      return;
    }
    // Every save is a new revision, and its arrival ends the draft and the saving state.
    setMessage(null);
    await router.invalidate();
  };
  // The list the select offers and the connection come back with the page, so a change reloads it.
  const reload = async (result: { ok: true } | { ok: false; reason: string }) => {
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
    setOpened({ revision: revision.revision, fields: kit.fieldsOf(revision.config) });
    setDraft(null);
    setHistory(null);
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription className="text-pretty">
            The {descriptor.name} account this workspace's devboxes run in, and are billed to. Each
            workspace connects its own.
          </CardDescription>
          <CardAction className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className={
                connection
                  ? "size-1.5 rounded-full bg-emerald-500"
                  : "size-1.5 rounded-full bg-muted-foreground/40"
              }
            />
            {connection ? "Connected" : "Not connected"}
          </CardAction>
        </CardHeader>
        <CardContent>
          <ComputeConnection
            descriptor={descriptor}
            credentialOf={kit.credentialOf}
            connected={connection}
            disabled={!isAdmin}
            nameOf={nameOf}
            when={when}
            onConnect={async (credential, label) =>
              reload(
                await connectCompute({
                  data: { workspaceId: view.workspace.id, provider, credential, label },
                }),
              )
            }
            onDisconnect={async () =>
              reload(
                await disconnectCompute({ data: { workspaceId: view.workspace.id, provider } }),
              )
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <kit.Mark className="text-muted-foreground size-5" />
            {descriptor.name}
          </CardTitle>
          <CardDescription className="text-pretty">
            Every task starts a {descriptor.name} devbox from this configuration. A change applies
            to tasks started after it is saved.
            {runsElsewhere
              ? ` The workspace runs on ${data.environment?.provider} now; saving here switches it.`
              : ""}
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
          <kit.Form
            fields={fields}
            templates={approvedImages}
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
          <CardTitle className="first-letter:uppercase">
            Your {descriptor.template.noun.many}
          </CardTitle>
          <CardDescription className="text-pretty">
            {builds
              ? `The ${descriptor.template.noun.many} this workspace may launch. Notus builds its own from the Notus base recipe in your account when you connect it, and adds it here. You can add others of your own; whoever adds one vouches for what it contains.`
              : `The ${descriptor.template.noun.many} this workspace may launch. Build yours from the Notus base recipe and add its reference; it then appears in the field above. Notus does not inspect it: whoever adds one vouches for what it contains.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {builds ? (
            <TemplateBuild
              descriptor={descriptor}
              workspaceId={view.workspace.id}
              build={build}
              connected={connection !== null}
              disabled={!isAdmin}
              onBuild={async () =>
                reload(await buildTemplate({ data: { workspaceId: view.workspace.id, provider } }))
              }
              onPoll={() => router.invalidate()}
            />
          ) : null}
          <WorkspaceTemplates
            descriptor={descriptor}
            short={kit.shortTemplate}
            problemOf={kit.templateProblem}
            images={workspaceImages.filter((image) => image.provider === provider)}
            selected={kit.templateOf(kit.fieldsOf(stored))}
            defaultRef={defaultImage}
            disabled={!isAdmin}
            nameOf={nameOf}
            onAdd={async (ref, label) =>
              reload(
                await addImage({ data: { workspaceId: view.workspace.id, provider, ref, label } }),
              )
            }
            onRemove={async (ref) =>
              reload(await removeImage({ data: { workspaceId: view.workspace.id, provider, ref } }))
            }
            onDefault={async (ref) =>
              reload(
                await setDefaultImage({ data: { workspaceId: view.workspace.id, provider, ref } }),
              )
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
              const changed =
                revision.provider === provider
                  ? changes(previous?.config, revision.config, kit.shortTemplate)
                  : [];
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
                    {revision.provider === provider ? (
                      <Button variant="outline" size="sm" onClick={() => open(revision)}>
                        Open
                      </Button>
                    ) : null}
                  </div>
                  {revision.provider !== provider ? (
                    <p className="text-muted-foreground text-xs">
                      A configuration for {revision.provider}.
                    </p>
                  ) : changed.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {previous ? "Saved unchanged." : "The first revision."}
                    </p>
                  ) : (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {changed.map((change) => (
                        <div key={change.path} className="contents">
                          <dt className="text-muted-foreground">{kit.labelOf(change.path)}</dt>
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
