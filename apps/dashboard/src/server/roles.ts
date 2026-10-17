import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";

const api = () => Cloudflare.toRpcAsync<Api>(env.API);
const cookie = () => getRequestHeader("cookie") ?? "";

export const listRoles = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await api().dashboardRoles(cookie(), data.workspaceId));
export type RoleRow = Extract<Awaited<ReturnType<typeof listRoles>>, { ok: true }>["value"][number];

export const roleHistory = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string; name: string }) => input)
  .handler(
    async ({ data }) => await api().dashboardRoleHistory(cookie(), data.workspaceId, data.name),
  );
export type RevisionRow = Extract<
  Awaited<ReturnType<typeof roleHistory>>,
  { ok: true }
>["value"][number];

export const saveRole = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; name: string; summary: string; body: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardSaveRole(cookie(), data.workspaceId, data.name, data.summary, data.body),
  );

export const deleteRole = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; name: string }) => input)
  .handler(
    async ({ data }) => await api().dashboardDeleteRole(cookie(), data.workspaceId, data.name),
  );
