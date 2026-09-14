import { IconDotsVertical, IconShieldCheckFilled, IconUserMinus } from "@tabler/icons-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeMember, setRole } from "../server/workspaces";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/members")({ component: Members });

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Members() {
  const { me, view, current } = useWorkspace();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (!me) return null;
  const isAdmin = view.role === "admin";
  const explain = (reason: string) =>
    setMessage(
      reason === "last-admin"
        ? "A workspace keeps at least one admin."
        : `That did not work (${reason}).`,
    );
  const change = async (userId: string, role: "admin" | "member") => {
    const result = await setRole({ data: { workspaceId: view.workspace.id, userId, role } });
    if (!result.ok) explain(result.reason);
    await router.invalidate();
  };
  const remove = async (userId: string) => {
    const result = await removeMember({ data: { workspaceId: view.workspace.id, userId } });
    if (!result.ok) explain(result.reason);
    await router.invalidate();
  };
  return (
    <AppShell
      me={me}
      current={current}
      active="members"
      title="Members"
      description="Who can start tasks from this workspace's channels."
    >
      <ul className="divide-y rounded-lg border">
        {view.members.map((member) => {
          const name = member.name ?? "Not signed in yet";
          const you = member.userId === me.user.id;
          return (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-3 text-sm">
              <Avatar className="size-9">
                {member.image ? <AvatarImage src={member.image} alt="" /> : null}
                <AvatarFallback>{member.name ? initialsOf(member.name) : "?"}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {name}
                  {you ? <span className="text-muted-foreground font-normal"> (you)</span> : null}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {member.email ?? `joined via ${member.provenance}`}
                </span>
              </div>
              <Badge variant={member.role === "admin" ? "default" : "secondary"}>
                {member.role}
              </Badge>
              {isAdmin ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
                        <IconDotsVertical className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() =>
                        change(member.userId, member.role === "admin" ? "member" : "admin")
                      }
                    >
                      <IconShieldCheckFilled className="size-4" />
                      {member.role === "admin" ? "Make member" : "Make admin"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => remove(member.userId)}
                      className="text-destructive"
                    >
                      <IconUserMinus className="size-4" />
                      Remove from workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </AppShell>
  );
}
