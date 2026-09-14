import {
  IconHash,
  IconLockFilled,
  IconMessageCircleOff,
  IconTrashFilled,
} from "@tabler/icons-react";
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

type Available = {
  teamId: string;
  channels: ReadonlyArray<{ id: string; name: string; isMember: boolean; isPrivate: boolean }>;
};

function Channels() {
  const { me, view, current } = useWorkspace();
  const { channels } = collectionsOf(view.workspace.id);
  const { data } = useLiveQuery({
    query: (q) => q.from({ channel: channels }).orderBy(({ channel }) => channel.channelId, "asc"),
  });
  // Slack's channel list: null while loading, or the failure reason when Slack refused.
  const [available, setAvailable] = useState<Available | null>(null);
  const [listing, setListing] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const isAdmin = view.role === "admin";
  useEffect(() => {
    void slackChannels().then((result) => {
      if (result.ok) setAvailable(result.value);
      else setListing(result.reason);
    });
  }, []);
  if (!me) return null;
  const loading = available === null && listing === null;
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
  const options = available?.channels.filter((c) => c.isMember && !linked.has(c.id)) ?? [];
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
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {loading ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <span className="truncate leading-4 font-medium">
                      {info?.name ?? row.channelId}
                    </span>
                  )}
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
      {isAdmin && listing === null ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="channel">Add a channel</Label>
          <Select
            value={null}
            disabled={loading}
            onValueChange={(value: string | null) => {
              if (value) add(value);
            }}
          >
            <SelectTrigger id="channel" className="w-full">
              <SelectValue placeholder="Channels the Notus app is in…" />
            </SelectTrigger>
            <SelectContent>
              {options.length === 0 ? (
                <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
                  <IconMessageCircleOff className="size-4" />
                  No channels found
                </div>
              ) : (
                options.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    #{c.name}
                    {c.isPrivate ? " (private)" : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Invite the app to a channel in Slack first if it is missing here.
          </p>
        </div>
      ) : null}
      {isAdmin && listing !== null ? (
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
          <p className="text-muted-foreground text-sm">
            Slack refused to list channels ({listing}). The app needs the channels:read and
            groups:read scopes; until then, add a channel by its ID.
          </p>
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
