import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";

// Every call forwards the request's cookie; the API resolves and authorizes the user itself.
const api = () => Cloudflare.toRpcAsync<Api>(env.API);
const cookie = () => getRequestHeader("cookie") ?? "";
type Role = "admin" | "member";

export const createWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string; slug?: string }) => input)
  .handler(
    async ({ data }) => await api().dashboardCreateWorkspace(cookie(), data.name, data.slug),
  );

export const updateWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; name?: string; slug?: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardUpdateWorkspace(cookie(), data.workspaceId, {
        name: data.name,
        slug: data.slug,
      }),
  );

export const getWorkspaceBySlug = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => input)
  .handler(async ({ data }) => await api().dashboardWorkspaceBySlug(cookie(), data.slug));

export const getWorkspace = createServerFn({ method: "GET" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await api().dashboardWorkspace(cookie(), data.workspaceId));
export type WorkspaceView = Extract<
  Awaited<ReturnType<typeof getWorkspace>>,
  { ok: true }
>["value"];

export const setRole = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; userId: string; role: Role }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardSetRole(cookie(), data.workspaceId, data.userId, data.role),
  );

export const removeMember = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; userId: string }) => input)
  .handler(
    async ({ data }) => await api().dashboardRemoveMember(cookie(), data.workspaceId, data.userId),
  );

export const createInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; role: Role }) => input)
  .handler(
    async ({ data }) => await api().dashboardCreateInvite(cookie(), data.workspaceId, data.role),
  );

export const revokeInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; inviteId: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardRevokeInvite(cookie(), data.workspaceId, data.inviteId),
  );

export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => await api().dashboardAcceptInvite(cookie(), data.token));

export const addChannel = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; teamId: string; channelId: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardAddChannel(cookie(), data.workspaceId, data.teamId, data.channelId),
  );

export const removeChannel = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; teamId: string; channelId: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardRemoveChannel(cookie(), data.workspaceId, data.teamId, data.channelId),
  );

export const slackChannels = createServerFn({ method: "GET" }).handler(
  async () => await api().dashboardSlackChannels(cookie()),
);
