import { IconShieldCheckFilled, IconUserMinus } from "@tabler/icons-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { removeMember, setRole } from "../server/workspaces";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/members")({ component: Members });

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
        {view.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-4 px-4 py-3 text-sm">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono">
                {member.userId}
                {member.userId === me.user.id ? (
                  <span className="text-muted-foreground"> · you</span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">joined via {member.provenance}</span>
            </div>
            <Badge variant={member.role === "admin" ? "default" : "secondary"}>{member.role}</Badge>
            {isAdmin ? (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    change(member.userId, member.role === "admin" ? "member" : "admin")
                  }
                >
                  <IconShieldCheckFilled className="size-4" />
                  {member.role === "admin" ? "Make member" : "Make admin"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(member.userId)}>
                  <IconUserMinus className="size-4" />
                  Remove
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </AppShell>
  );
}
