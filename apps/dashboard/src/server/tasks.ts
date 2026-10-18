import { createServerFn } from "@tanstack/react-start";
import { call } from "./api";

export const listTasks = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.tasks(data)));
export type TaskRow = Extract<Awaited<ReturnType<typeof listTasks>>, { ok: true }>["value"][number];

export const getTask = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string; taskId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.task(data)));
export type TaskView = Extract<Awaited<ReturnType<typeof getTask>>, { ok: true }>["value"];
export type TurnView = TaskView["timeline"][number];
export type StepView = TurnView["steps"][number];
export type StepItem = StepView["items"][number];
export type CommandView = NonNullable<Extract<StepItem, { kind: "tool" }>["command"]>;
