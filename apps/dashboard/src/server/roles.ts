import { createServerFn } from "@tanstack/react-start";
import { call } from "./api";

export const listRoles = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.roles(data)));
export type RoleRow = Extract<Awaited<ReturnType<typeof listRoles>>, { ok: true }>["value"][number];

export const roleHistory = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string; name: string }) => input)
  .handler(async ({ data }) => await call((api) => api.roleHistory(data)));
export type RevisionRow = Extract<
  Awaited<ReturnType<typeof roleHistory>>,
  { ok: true }
>["value"][number];

export const saveRole = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; name: string; summary: string; body: string }) => input)
  .handler(async ({ data }) => await call((api) => api.saveRole(data)));

export const deleteRole = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; name: string }) => input)
  .handler(async ({ data }) => await call((api) => api.deleteRole(data)));
