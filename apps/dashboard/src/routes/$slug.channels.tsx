import { IconHash, IconLockFilled, IconTrashFilled } from "@tabler/icons-react";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { collectionsOf, type ChannelRow } from "../collections";
import { slackChannels } from "../server/workspaces";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/channels")({
  // TanStack DB collections are client-side only.
  ssr: false,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (parent.loaderData) await collectionsOf(parent.loaderData.workspace.id).channels.preload();
  },
  component: Channels,
});

function Channels() {
  const { me, view, current } = useWorkspace();
  const { channels } = collectionsOf(view.workspace.id);
  const { data } = useLiveQuery({
    query: (q) => q.from({ channel: channels }).orderBy(({ channel }) => channel.channelId, "asc"),
  });
  const [available, setAvailable] = useState<{
    teamId: string;
    channels: ReadonlyArray<{ id: string; name: string; isMember: boolean; isPrivate: boolean }>;
  } | null>(null);
  const [listing, setListing] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = view.role === "admin";
  useEffect(() => {
    if (!isAdmin) return;
    void slackChannels().then((result) => {
      if (result.ok) setAvailable(result.value);
      else setListing(result.reason);
    });
  }, [isAdmin]);
  if (!me) return null;
  const byId = new Map(available?.channels.map((c) => [c.id, c]) ?? []);
  const linked = new Set(data.map((row) => row.channelId));
  const report = (error: unknown) =>
    setMessage(
      error instanceof Error ? `That did not work (${error.message}).` : "That did not work.",
    );
  const add = (channelId: string) => {
    const teamId = available?.teamId ?? data[0]?.teamId;
    if (!teamId) return;
    channels
      .insert({ workspaceId: view.workspace.id, teamId, channelId })
      .isPersisted.promise.catch(report);
  };
  const remove = (row: ChannelRow) => {
    channels.delete(`${row.teamId}:${row.channelId}`).isPersisted.promise.catch(report);
  };
  return (
    <AppShell
      me={me}
      current={current}
      active="channels"
      title="Slack channels"
      description="Mentioning Notus in one of these channels starts a task in this workspace."
    >
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No channels linked yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((row) => {
            const info = byId.get(row.channelId);
            return (
              <li
                key={`${row.teamId}:${row.channelId}`}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                {info?.isPrivate ? (
                  <IconLockFilled className="text-muted-foreground size-4" />
                ) : (
                  <IconHash className="text-muted-foreground size-4" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{info?.name ?? row.channelId}</span>
                  <span className="text-muted-foreground font-mono text-xs">{row.channelId}</span>
                </div>
                {isAdmin ? (
                  <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                    <IconTrashFilled className="size-4" />
                    Remove
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {isAdmin && available ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel">Add a channel</Label>
          <select
            id="channel"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value=""
            onChange={(event) => {
              if (event.target.value) add(event.target.value);
            }}
          >
            <option value="">Channels the Notus app is in…</option>
            {available.channels
              .filter((c) => c.isMember && !linked.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                  {c.isPrivate ? " (private)" : ""}
                </option>
              ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Invite the app to a channel in Slack first if it is missing here.
          </p>
        </div>
      ) : null}
      {isAdmin && !available ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (/^[CG][A-Z0-9]{6,}$/.test(manual)) {
              add(manual);
              setManual("");
            }
          }}
        >
          {listing ? (
            <p className="text-muted-foreground text-sm">
              Slack refused to list channels ({listing}). The app needs the channels:read and
              groups:read scopes; until then, add a channel by its ID.
            </p>
          ) : null}
          <Label htmlFor="manual">Channel ID</Label>
          <div className="flex gap-2">
            <Input
              id="manual"
              className="font-mono"
              value={manual}
              placeholder="C0123456789"
              onChange={(event) => setManual(event.target.value.trim())}
            />
            <Button type="submit" disabled={!/^[CG][A-Z0-9]{6,}$/.test(manual)}>
              Add
            </Button>
          </div>
        </form>
      ) : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </AppShell>
  );
}
