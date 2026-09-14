import { IconMailFilled, IconMessageCircleFilled, IconUsersGroup } from "@tabler/icons-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/")({ component: Overview });

function Overview() {
  const { me, view, current } = useWorkspace();
  if (!me) return null;
  const open = view.invites.filter(
    (i) => i.revokedAt === null && i.acceptedAt === null && i.expiresAt > Date.now(),
  ).length;
  const items = [
    {
      to: "/$slug/members" as const,
      icon: IconUsersGroup,
      label: "Members",
      value: view.members.length,
      hint: `${view.members.filter((m) => m.role === "admin").length} admin`,
    },
    {
      to: "/$slug/channels" as const,
      icon: IconMessageCircleFilled,
      label: "Slack channels",
      value: view.channels.length,
      hint: "mentions start tasks here",
    },
    ...(view.role === "admin"
      ? [
          {
            to: "/$slug/invites" as const,
            icon: IconMailFilled,
            label: "Open invites",
            value: open,
            hint: "valid for a week",
          },
        ]
      : []),
  ];
  return (
    <AppShell
      me={me}
      current={current}
      active="overview"
      title={view.workspace.name}
      description={`notus.run/${view.workspace.slug}`}
    >
      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            params={{ slug: current.slug }}
            className="bg-background hover:bg-accent flex flex-col gap-2 p-5 transition-colors"
          >
            <dt className="text-muted-foreground flex items-center gap-2 text-sm">
              <item.icon className="size-4" />
              {item.label}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">{item.value}</dd>
            <dd className="text-muted-foreground text-xs">{item.hint}</dd>
          </Link>
        ))}
      </dl>
      <section className="text-muted-foreground text-sm">
        Mention Notus in a linked channel to start a task. Tasks, their pull requests and their
        devboxes will appear here in a later increment.
      </section>
    </AppShell>
  );
}
