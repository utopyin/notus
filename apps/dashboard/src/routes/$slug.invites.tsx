import { IconChevronDown, IconCopy, IconMailFilled, IconX } from "@tabler/icons-react";
import { isNull, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collectionsOf, type InviteRow } from "../collections";
import { createInvite } from "../server/workspaces";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/invites")({
  staticData: {
    shell: {
      active: "invites",
      title: "Invites",
      description: "Invite links are valid for a week and can be used once.",
    },
  },
  ssr: false,
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return;
    if (parent.loaderData.role !== "admin") throw redirect({ to: "/$slug", params });
    await collectionsOf(parent.loaderData.workspace.id).invites.preload();
  },
  component: Invites,
});

function Invites() {
  const { view } = useWorkspace();
  const { invites } = collectionsOf(view.workspace.id);
  const { data } = useLiveQuery({
    // Revoked invites leave the list; the optimistic update hides them at once.
    query: (q) =>
      q
        .from({ invite: invites })
        .where(({ invite }) => isNull(invite.revokedAt))
        .orderBy(({ invite }) => invite.createdAt, "desc"),
  });
  const [fresh, setFresh] = useState<{ role: string; url: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = async (role: "admin" | "member") => {
    if (creating) return;
    setCreating(true);
    const result = await createInvite({ data: { workspaceId: view.workspace.id, role } });
    setCreating(false);
    if (!result.ok) {
      setMessage(`That did not work (${result.reason}).`);
      return;
    }
    // The token is shown once; the collection only ever holds the hashed row's metadata.
    setFresh({ role, url: `${window.location.origin}/invite/${result.value.token}` });
    setCopied(false);
    invites.insert(result.value.invite, { metadata: { persisted: true } });
  };
  const revoke = (invite: InviteRow) => {
    invites
      .update(invite.id, (draft) => {
        draft.revokedAt = Date.now();
      })
      .isPersisted.promise.catch((error: unknown) =>
        setMessage(
          error instanceof Error ? `That did not work (${error.message}).` : "That did not work.",
        ),
      );
  };
  const copy = async () => {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh.url);
    setCopied(true);
  };
  const status = (invite: InviteRow) =>
    invite.revokedAt !== null
      ? { label: "Revoked", tone: "secondary" as const }
      : invite.acceptedAt !== null
        ? { label: "Accepted", tone: "default" as const }
        : invite.expiresAt < Date.now()
          ? { label: "Expired", tone: "secondary" as const }
          : {
              label: `Open until ${new Date(invite.expiresAt).toLocaleDateString()}`,
              tone: "outline" as const,
            };
  // Show who accepted by name when they are a member we know.
  const nameOf = (userId: string) => view.members.find((m) => m.userId === userId)?.name ?? userId;
  return (
    <>
      <div className="flex items-center">
        <Button
          variant="outline"
          className="rounded-r-none border-r-0"
          disabled={creating}
          onClick={() => create("member")}
        >
          <IconMailFilled className="size-4" />
          Invite a member
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="rounded-l-none px-2"
                disabled={creating}
                aria-label="More invite options"
              >
                <IconChevronDown className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-max whitespace-nowrap">
            <DropdownMenuItem onClick={() => create("admin")}>Invite an admin</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {fresh ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">
            Copy this {fresh.role} invite link now. It is shown only once.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{fresh.url}</code>
            <Button variant="outline" size="sm" onClick={copy}>
              <IconCopy className="size-4" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No invites yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((invite) => {
            const s = status(invite);
            return (
              <li key={invite.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium capitalize">{invite.role} invite</span>
                  <span className="text-muted-foreground text-xs">
                    created {new Date(invite.createdAt).toLocaleString()}
                    {invite.acceptedBy ? ` · accepted by ${nameOf(invite.acceptedBy)}` : ""}
                  </span>
                </div>
                <Badge variant={s.tone}>{s.label}</Badge>
                {invite.revokedAt === null && invite.acceptedAt === null ? (
                  <Button variant="ghost" size="sm" onClick={() => revoke(invite)}>
                    <IconX className="size-4" />
                    Revoke
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </>
  );
}
