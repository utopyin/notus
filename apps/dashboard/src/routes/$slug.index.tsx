import { IconGitPullRequest } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { queryClient } from "../query";
import { isPlatform, slotsFor } from "../platforms";
import { tasksQuery } from "../tasks/queries";
import { StatusDot, StatusLabel, plain, when } from "../tasks/status";
import { useWorkspace } from "./$slug";

/** The workspace's landing page: every task, live. */
export const Route = createFileRoute("/$slug/")({
  staticData: {
    shell: {
      active: "tasks",
      title: "Tasks",
      description: "Everything Notus is working on in this workspace, as it happens.",
    },
  },
  ssr: false,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (parent.loaderData)
      await queryClient.ensureQueryData(tasksQuery(parent.loaderData.workspace.id));
  },
  component: Tasks,
});

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Tasks() {
  const { view, current } = useWorkspace();
  const { data: tasks, error } = useQuery(tasksQuery(view.workspace.id), queryClient);
  if (error && !tasks) return <p className="text-destructive text-sm">{error.message}</p>;
  if (!tasks) return null;
  if (tasks.length === 0)
    return (
      <section className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        No tasks yet. Mention Notus in a covered channel to start one; it appears here as soon as
        Notus picks it up.
      </section>
    );
  return (
    <ul className="divide-foreground/10 bg-card ring-foreground/10 divide-y overflow-hidden rounded-lg ring-1">
      {tasks.map((task) => {
        const Mark = isPlatform(task.origin.platform) ? slotsFor(task.origin.platform).Mark : null;
        return (
          <li key={task.id} className="hover:bg-accent/50 transition-colors">
            <Link
              to="/$slug/tasks/$taskId"
              params={{ slug: current.slug, taskId: task.id }}
              className="flex items-start gap-3 px-4 py-3"
            >
              <StatusDot status={task.status} className="mt-1.5" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium">
                  {plain(task.request) || "Untitled task"}
                </span>
                <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {task.initiator ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar className="size-4">
                        {task.initiator.image ? <AvatarImage src={task.initiator.image} /> : null}
                        <AvatarFallback className="text-[8px]">
                          {initials(task.initiator.name)}
                        </AvatarFallback>
                      </Avatar>
                      {task.initiator.name}
                    </span>
                  ) : null}
                  {Mark ? <Mark className="size-3" /> : null}
                  {task.repository ? <span className="font-mono">{task.repository}</span> : null}
                  {task.pullRequest ? (
                    <span className="inline-flex items-center gap-1">
                      <IconGitPullRequest className="size-3" />#{task.pullRequest.number}
                    </span>
                  ) : null}
                  <span>Updated {when(task.updatedAt)}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <StatusLabel status={task.status} />
                {task.activity ? (
                  <span className="text-muted-foreground max-w-56 truncate text-xs">
                    {task.activity}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
