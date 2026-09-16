import { IconMailFilled, IconAppsFilled, IconUserFilled } from "@tabler/icons-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/")({
  staticData: { shell: { active: "overview" } },
  component: Overview,
});

function Overview() {
  const { view, current } = useWorkspace();
  const open = view.invites.filter(
    (i) => i.revokedAt === null && i.acceptedAt === null && i.expiresAt > Date.now(),
  ).length;
  const items = [
    {
      to: "/$slug/settings" as const,
      icon: IconUserFilled,
      label: "Members",
      value: view.members.length,
      hint: `${view.members.filter((m) => m.role === "admin").length} admin`,
    },
    {
      to: "/$slug/platforms" as const,
      icon: IconAppsFilled,
      label: "Platforms",
      value: view.installations.length,
      hint: `${view.scopes.length} ${view.scopes.length === 1 ? "scope" : "scopes"} covered`,
    },
    ...(view.role === "admin"
      ? [
          {
            to: "/$slug/settings" as const,
            icon: IconMailFilled,
            label: "Open invites",
            value: open,
            hint: "valid for a week",
          },
        ]
      : []),
  ];
  return (
    <>
      <dl className="grid gap-px overflow-hidden rounded-lg bg-foreground/10 ring-1 ring-foreground/10 sm:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            params={{ slug: current.slug }}
            className="bg-card hover:bg-accent flex flex-col gap-2 p-5 transition-colors"
          >
            <dt className="text-muted-foreground flex items-center gap-2 text-sm">
              <item.icon className="size-4" />
              {item.label}
            </dt>
            <dd className="text-2xl font-medium tabular-nums">{item.value}</dd>
            <dd className="text-muted-foreground text-xs">{item.hint}</dd>
          </Link>
        ))}
      </dl>
      <section className="text-muted-foreground text-sm">
        Mention Notus in a linked channel to start a task. Tasks, their pull requests and their
        devboxes will appear here in a later increment.
      </section>
    </>
  );
}
