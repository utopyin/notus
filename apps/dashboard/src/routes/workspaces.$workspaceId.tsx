import { createCollection, useLiveQuery } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import {
  createFileRoute,
  getRouteApi,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { queryClient } from "../query";
import {
  addChannel,
  createInvite,
  getWorkspace,
  removeChannel,
  removeMember,
  revokeInvite,
  setRole,
  slackChannels,
  type WorkspaceView,
} from "../server/workspaces";

const root = getRouteApi("__root__");

type ChannelRow = WorkspaceView["channels"][number];
type InviteRow = WorkspaceView["invites"][number];

/**
 * One pair of collections per workspace. Channels and invites are edited optimistically: the row
 * appears or disappears at once, and the server call behind it either confirms or rolls it back.
 */
const collections = new Map<
  string,
  { channels: ReturnType<typeof channelCollection>; invites: ReturnType<typeof inviteCollection> }
>();
const load = async (workspaceId: string) => {
  const result = await getWorkspace({ data: { workspaceId } });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};
const channelCollection = (workspaceId: string) =>
  createCollection(
    queryCollectionOptions({
      queryKey: ["workspace", workspaceId, "channels"],
      queryFn: async () => [...(await load(workspaceId)).channels],
      queryClient,
      getKey: (row: ChannelRow) => `${row.teamId}:${row.channelId}`,
      onInsert: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const row = mutation.modified;
          const result = await addChannel({
            data: { workspaceId, teamId: row.teamId, channelId: row.channelId },
          });
          if (!result.ok) throw new Error(result.reason);
        }
      },
      onDelete: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const row = mutation.original;
          const result = await removeChannel({
            data: { workspaceId, teamId: row.teamId, channelId: row.channelId },
          });
          if (!result.ok) throw new Error(result.reason);
        }
      },
    }),
  );
const inviteCollection = (workspaceId: string) =>
  createCollection(
    queryCollectionOptions({
      queryKey: ["workspace", workspaceId, "invites"],
      queryFn: async () => [...(await load(workspaceId)).invites],
      queryClient,
      getKey: (row: InviteRow) => row.id,
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          if (mutation.changes.revokedAt === undefined) continue;
          const result = await revokeInvite({ data: { workspaceId, inviteId: mutation.key } });
          if (!result.ok) throw new Error(result.reason);
        }
      },
    }),
  );
const collectionsOf = (workspaceId: string) => {
  const existing = collections.get(workspaceId);
  if (existing) return existing;
  const created = {
    channels: channelCollection(workspaceId),
    invites: inviteCollection(workspaceId),
  };
  collections.set(workspaceId, created);
  return created;
};

export const Route = createFileRoute("/workspaces/$workspaceId")({
  // TanStack DB collections are client-side only.
  ssr: false,
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) throw redirect({ to: "/" });
    const result = await getWorkspace({ data: { workspaceId: params.workspaceId } });
    if (!result.ok) throw notFound();
    const { channels, invites } = collectionsOf(params.workspaceId);
    await Promise.all([channels.preload(), invites.preload()]);
    return result.value;
  },
  component: WorkspacePage,
});

function WorkspacePage() {
  const me = root.useLoaderData();
  const view = Route.useLoaderData();
  const { workspaceId } = Route.useParams();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = view.role === "admin";
  const fail = (reason: string) => setMessage(`That did not work (${reason}).`);
  if (!me) return null;
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <section>
        <h1 className="text-lg font-medium">{view.workspace.name}</h1>
        <p className="text-muted-foreground text-sm">
          {view.workspace.slug} · you are {view.role === "admin" ? "an admin" : "a member"}
        </p>
      </section>
      <Members
        view={view}
        meId={me.user.id}
        isAdmin={isAdmin}
        onFail={fail}
        onChange={() => router.invalidate()}
      />
      <Channels workspaceId={workspaceId} isAdmin={isAdmin} onFail={fail} />
      {isAdmin ? <Invites workspaceId={workspaceId} onFail={fail} /> : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </main>
  );
}

function Members(props: {
  view: WorkspaceView;
  meId: string;
  isAdmin: boolean;
  onFail: (reason: string) => void;
  onChange: () => Promise<void>;
}) {
  const { view, meId, isAdmin, onFail, onChange } = props;
  const change = async (userId: string, role: "admin" | "member") => {
    const result = await setRole({ data: { workspaceId: view.workspace.id, userId, role } });
    if (!result.ok) onFail(result.reason);
    await onChange();
  };
  const remove = async (userId: string) => {
    const result = await removeMember({ data: { workspaceId: view.workspace.id, userId } });
    if (!result.ok) onFail(result.reason);
    await onChange();
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Members</h2>
      {view.members.map((member) => (
        <div
          key={member.userId}
          className="flex items-center justify-between rounded-md border p-3 text-sm"
        >
          <div>
            <div className="font-mono">
              {member.userId === meId ? `${member.userId} (you)` : member.userId}
            </div>
            <div className="text-muted-foreground">
              {member.role} · {member.provenance}
            </div>
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => change(member.userId, member.role === "admin" ? "member" : "admin")}
              >
                Make {member.role === "admin" ? "member" : "admin"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => remove(member.userId)}>
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Channels(props: {
  workspaceId: string;
  isAdmin: boolean;
  onFail: (reason: string) => void;
}) {
  const { workspaceId, isAdmin, onFail } = props;
  const { channels } = collectionsOf(workspaceId);
  const { data } = useLiveQuery({
    query: (q) => q.from({ channel: channels }).orderBy(({ channel }) => channel.channelId, "asc"),
  });
  const [available, setAvailable] = useState<{
    teamId: string;
    channels: ReadonlyArray<{ id: string; name: string; isMember: boolean; isPrivate: boolean }>;
  } | null>(null);
  const [listing, setListing] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  useEffect(() => {
    if (!isAdmin) return;
    void slackChannels().then((result) => {
      if (result.ok) setAvailable(result.value);
      else setListing(result.reason);
    });
  }, [isAdmin]);
  const names = new Map(available?.channels.map((c) => [c.id, c.name]) ?? []);
  const linked = new Set(data.map((row) => row.channelId));
  const add = (channelId: string, teamId = available?.teamId ?? data[0]?.teamId) => {
    if (!teamId) return;
    const tx = channels.insert({ workspaceId, teamId, channelId });
    tx.isPersisted.promise.catch((error: unknown) =>
      onFail(error instanceof Error ? error.message : "failed"),
    );
  };
  const remove = (row: ChannelRow) => {
    const tx = channels.delete(`${row.teamId}:${row.channelId}`);
    tx.isPersisted.promise.catch((error: unknown) =>
      onFail(error instanceof Error ? error.message : "failed"),
    );
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Slack channels</h2>
      <p className="text-muted-foreground text-sm">
        Mentions of Notus in these channels start tasks in this workspace.
      </p>
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No channels yet.</p>
      ) : (
        data.map((row) => (
          <div
            key={`${row.teamId}:${row.channelId}`}
            className="flex items-center justify-between rounded-md border p-3 text-sm"
          >
            <div>
              <div>#{names.get(row.channelId) ?? row.channelId}</div>
              <div className="text-muted-foreground font-mono">{row.channelId}</div>
            </div>
            {isAdmin ? (
              <Button variant="outline" size="sm" onClick={() => remove(row)}>
                Remove
              </Button>
            ) : null}
          </div>
        ))
      )}
      {isAdmin && listing ? (
        <p className="text-muted-foreground text-sm">
          Slack refused to list channels ({listing}). The app needs the channels:read and
          groups:read scopes; until then, add a channel by its ID.
        </p>
      ) : null}
      {isAdmin && !available ? (
        <form
          className="flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (/^[CG][A-Z0-9]{6,}$/.test(manual)) {
              add(manual);
              setManual("");
            }
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Channel ID</span>
            <input
              className="rounded-md border px-3 py-2 font-mono"
              value={manual}
              placeholder="C0123456789"
              onChange={(event) => setManual(event.target.value.trim())}
            />
          </label>
          <Button type="submit" size="sm" disabled={!/^[CG][A-Z0-9]{6,}$/.test(manual)}>
            Add
          </Button>
        </form>
      ) : null}
      {isAdmin && available ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Add a channel</span>
          <select
            className="rounded-md border px-3 py-2"
            value=""
            onChange={(event) => {
              if (event.target.value) add(event.target.value);
            }}
          >
            <option value="">Choose a channel the Notus app is in…</option>
            {available.channels
              .filter((c) => c.isMember && !linked.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                  {c.isPrivate ? " (private)" : ""}
                </option>
              ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}

function Invites(props: { workspaceId: string; onFail: (reason: string) => void }) {
  const { workspaceId, onFail } = props;
  const { invites } = collectionsOf(workspaceId);
  const { data } = useLiveQuery({
    query: (q) => q.from({ invite: invites }).orderBy(({ invite }) => invite.createdAt, "desc"),
  });
  const [fresh, setFresh] = useState<{ role: string; url: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const create = async (role: "admin" | "member") => {
    if (creating) return;
    setCreating(true);
    const result = await createInvite({ data: { workspaceId, role } });
    setCreating(false);
    if (!result.ok) {
      onFail(result.reason);
      return;
    }
    // The token is shown once; the collection only ever holds the hashed row's metadata.
    setFresh({ role, url: `${window.location.origin}/invite/${result.value.token}` });
    invites.insert(result.value.invite, { optimistic: false });
    void invites.utils.refetch();
  };
  const revoke = (invite: InviteRow) => {
    const tx = invites.update(invite.id, (draft) => {
      draft.revokedAt = Date.now();
    });
    tx.isPersisted.promise.catch((error: unknown) =>
      onFail(error instanceof Error ? error.message : "failed"),
    );
  };
  const status = (invite: InviteRow) =>
    invite.revokedAt !== null
      ? "revoked"
      : invite.acceptedAt !== null
        ? `accepted by ${invite.acceptedBy}`
        : invite.expiresAt < Date.now()
          ? "expired"
          : `open until ${new Date(invite.expiresAt).toLocaleDateString()}`;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Invites</h2>
      <div className="flex gap-2">
        <Button size="sm" disabled={creating} onClick={() => create("member")}>
          Invite a member
        </Button>
        <Button size="sm" variant="outline" disabled={creating} onClick={() => create("admin")}>
          Invite an admin
        </Button>
      </div>
      {fresh ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">
            Copy this {fresh.role} invite link now. It is shown only once.
          </div>
          <code className="mt-1 block break-all">{fresh.url}</code>
        </div>
      ) : null}
      {data.map((invite) => (
        <div
          key={invite.id}
          className="flex items-center justify-between rounded-md border p-3 text-sm"
        >
          <div>
            <div>{invite.role} invite</div>
            <div className="text-muted-foreground">{status(invite)}</div>
          </div>
          {invite.revokedAt === null && invite.acceptedAt === null ? (
            <Button variant="outline" size="sm" onClick={() => revoke(invite)}>
              Revoke
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
