import { createServerFn } from "@tanstack/react-start";
import { call } from "./api";

// Every call forwards the request's cookie; the API resolves and authorizes the user itself.

type Role = "admin" | "member";

export const createWorkspace = createServerFn({ method: "POST" })
  .validator((input: { name: string; slug?: string }) => input)
  .handler(async ({ data }) => await call((api) => api.createWorkspace(data)));

export const updateWorkspace = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; name?: string; slug?: string }) => input)
  .handler(async ({ data }) => await call((api) => api.updateWorkspace(data)));

export const getWorkspaceBySlug = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => await call((api) => api.workspaceBySlug(data)));

export const getWorkspace = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.workspace(data)));
export type WorkspaceView = Extract<
  Awaited<ReturnType<typeof getWorkspace>>,
  { ok: true }
>["value"];

export const setRole = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; userId: string; role: Role }) => input)
  .handler(async ({ data }) => await call((api) => api.setRole(data)));

export const removeMember = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; userId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.removeMember(data)));

export const createInvite = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; role: Role }) => input)
  .handler(async ({ data }) => await call((api) => api.createInvite(data)));

export const revokeInvite = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; inviteId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.revokeInvite(data)));

export const acceptInvite = createServerFn({ method: "POST" })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => await call((api) => api.acceptInvite(data)));

export type ScopeInput = {
  platform: "slack" | "github";
  installationId: string;
  scope: string;
  label?: string;
};
export const addScope = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; source: ScopeInput }) => input)
  .handler(async ({ data }) => await call((api) => api.addScope(data)));

export const removeScope = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; source: ScopeInput }) => input)
  .handler(async ({ data }) => await call((api) => api.removeScope(data)));

/** Where to send the admin to install a platform; the API remembers the intent until the platform returns. */
export const installUrl = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; platform: "slack" | "github" }) => input)
  .handler(async ({ data }) => await call((api) => api.installUrl(data)));

export const uninstall = createServerFn({ method: "POST" })
  .validator(
    (input: { workspaceId: string; platform: "slack" | "github"; installationId: string }) => input,
  )
  .handler(async ({ data }) => await call((api) => api.uninstall(data)));

/** The scopes one of the workspace's installations can see. */
export const listScopes = createServerFn({ method: "GET" })
  .validator(
    (input: { workspaceId: string; platform: "slack" | "github"; installationId: string }) => input,
  )
  .handler(async ({ data }) => await call((api) => api.listScopes(data)));
