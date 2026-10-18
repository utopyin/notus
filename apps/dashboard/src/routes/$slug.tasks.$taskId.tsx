import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { FC, ReactNode } from "react";
import { queryClient } from "../query";
import { isPlatform, slotsFor } from "../platforms";
import { taskQuery } from "../tasks/queries";
import { StatusLabel, plain, when } from "../tasks/status";
import { Timeline } from "../tasks/timeline";
import { useWorkspace } from "./$slug";

/** One task as it runs: what was asked, every step the operator took, and where it stands. */
export const Route = createFileRoute("/$slug/tasks/$taskId")({
  staticData: { shell: { active: "tasks", title: null } },
  ssr: false,
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (parent.loaderData)
      await queryClient.ensureQueryData(taskQuery(parent.loaderData.workspace.id, params.taskId));
  },
  component: Task,
});

const PHASES: Record<string, string> = {
  "pending-create": "Requested",
  creating: "Creating",
  "ambiguous-create": "Creating",
  created: "Created",
  activating: "Starting",
  "awaiting-readiness": "Starting",
  ready: "Ready",
  blocked: "Blocked",
};

const Row: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="min-w-0 text-sm break-words">{children}</dd>
  </div>
);

function Task() {
  const { view, current } = useWorkspace();
  const { taskId } = Route.useParams();
  const { data: task, error } = useQuery(taskQuery(view.workspace.id, taskId), queryClient);
  const back = (
    <Link
      to="/$slug"
      params={{ slug: current.slug }}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <IconArrowLeft className="size-4" />
      Tasks
    </Link>
  );
  if (!task)
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? (
          <p className="text-destructive text-sm">
            {error.message === "not-found" ? "This task does not exist." : error.message}
          </p>
        ) : null}
      </div>
    );
  const Mark = isPlatform(task.origin.platform) ? slotsFor(task.origin.platform).Mark : null;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        {back}
        <h1 className="line-clamp-3 text-xl font-semibold text-pretty">
          {plain(task.request) || "Untitled task"}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLabel status={task.status} />
          {task.activity ? (
            <span className="text-muted-foreground text-xs">{task.activity}</span>
          ) : null}
          {/* The last poll failed but an earlier answer is still shown. */}
          {error ? (
            <span className="text-destructive text-xs">Not updating: {error.message}</span>
          ) : null}
        </div>
      </header>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <Timeline task={task} />
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <dl className="bg-card flex flex-col gap-4 rounded-lg border p-4">
            <Row label="Started by">{task.initiator?.name ?? "Unknown"}</Row>
            <Row label="Started">{when(task.createdAt)}</Row>
            <Row label="Last activity">{when(task.updatedAt)}</Row>
            {task.closedAt !== null ? <Row label="Closed">{when(task.closedAt)}</Row> : null}
            <Row label="Repository">
              {task.repository ? (
                <span className="font-mono text-xs">{task.repository}</span>
              ) : (
                <span className="text-muted-foreground">Not chosen yet</span>
              )}
            </Row>
            {task.pullRequest ? (
              <Row label="Pull request">
                <a
                  href={task.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  #{task.pullRequest.number}
                  <IconExternalLink className="size-3" />
                </a>
              </Row>
            ) : null}
            <Row label="Devbox">
              {task.devbox ? (
                <span className="flex flex-col">
                  <span>
                    {PHASES[task.devbox.phase] ?? task.devbox.phase} on {task.devbox.provider}
                  </span>
                  {task.devbox.blockedReason ? (
                    <span className="text-destructive text-xs">{task.devbox.blockedReason}</span>
                  ) : null}
                  {task.devbox.resourceId ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {task.devbox.resourceId}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </Row>
            <Row label="Conversations">
              <ul className="flex flex-col gap-1">
                {task.sources.map((source) => {
                  const SourceMark = isPlatform(source.platform)
                    ? slotsFor(source.platform).Mark
                    : null;
                  return (
                    <li
                      key={`${source.platform}:${source.scope}:${source.conversation}`}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      {SourceMark ? <SourceMark className="size-3" /> : null}
                      <span className="truncate font-mono">
                        {source.scope} · {source.conversation}
                      </span>
                      {source.origin ? <span className="text-muted-foreground">origin</span> : null}
                    </li>
                  );
                })}
              </ul>
            </Row>
            {task.roles.length > 0 ? (
              <Row label="Specialists">
                <ul className="flex flex-col gap-0.5 text-xs">
                  {task.roles.map((role) => (
                    <li key={role.name} className="flex justify-between gap-2">
                      <span className="font-mono">{role.name}</span>
                      <span className="text-muted-foreground">revision {role.revision}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            ) : null}
            <Row label="Task">
              <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-xs">
                {Mark ? <Mark className="size-3" /> : null}
                {task.id}
              </span>
            </Row>
          </dl>
        </aside>
      </div>
    </div>
  );
}
