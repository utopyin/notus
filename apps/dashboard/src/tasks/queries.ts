import { queryOptions } from "@tanstack/react-query";
import { getTask, listTasks } from "../server/tasks";

/**
 * Tasks change while they run, so both views poll: the list every few seconds, an open task
 * faster. Polling pauses while the tab is hidden; each poll reads the task's own object.
 */
const listPollMs = 4_000;
const taskPollMs = 2_000;

export const tasksQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ["workspace", workspaceId, "tasks"],
    queryFn: async () => {
      const result = await listTasks({ data: { workspaceId } });
      if (!result.ok) throw new Error(result.reason);
      return result.value;
    },
    refetchInterval: listPollMs,
  });

export const taskQuery = (workspaceId: string, taskId: string) =>
  queryOptions({
    queryKey: ["workspace", workspaceId, "tasks", taskId],
    queryFn: async () => {
      const result = await getTask({ data: { workspaceId, taskId } });
      if (!result.ok) throw new Error(result.reason);
      return result.value;
    },
    refetchInterval: taskPollMs,
  });
