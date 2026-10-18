import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";

const api = () => Cloudflare.toRpcAsync<Api>(env.API);
const cookie = () => getRequestHeader("cookie") ?? "";

export const listTasks = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await api().dashboardTasks(cookie(), data.workspaceId));
export type TaskRow = Extract<Awaited<ReturnType<typeof listTasks>>, { ok: true }>["value"][number];

export const getTask = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string; taskId: string }) => input)
  .handler(async ({ data }) => await api().dashboardTask(cookie(), data.workspaceId, data.taskId));
export type TaskView = Extract<Awaited<ReturnType<typeof getTask>>, { ok: true }>["value"];
export type TurnView = TaskView["timeline"][number];
export type StepView = TurnView["steps"][number];
export type StepItem = StepView["items"][number];
export type CommandView = NonNullable<Extract<StepItem, { kind: "tool" }>["command"]>;
