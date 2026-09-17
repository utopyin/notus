import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";
import type { Json } from "../lib/json";

const api = () => Cloudflare.toRpcAsync<Api>(env.API);
const cookie = () => getRequestHeader("cookie") ?? "";

/** The workspace's devbox configuration and the images it may select: the deployment's and its own. */
export const getEnvironment = createServerFn({ method: "GET" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await api().dashboardEnvironment(cookie(), data.workspaceId));
export type EnvironmentView = Extract<
  Awaited<ReturnType<typeof getEnvironment>>,
  { ok: true }
>["value"];

export const environmentHistory = createServerFn({ method: "GET" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await api().dashboardEnvironmentHistory(cookie(), data.workspaceId));
export type EnvironmentRevision = Extract<
  Awaited<ReturnType<typeof environmentHistory>>,
  { ok: true }
>["value"][number];

/** The provider's policy validates the document before it is stored; a refusal carries its message. */
export const saveEnvironment = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; config: Json }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardSaveEnvironment(cookie(), data.workspaceId, data.config),
  );

/** An admin approves an image of the workspace's own by its immutable reference. */
export const addImage = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; ref: string; label: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardAddImage(cookie(), data.workspaceId, data.ref, data.label),
  );

export const removeImage = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; ref: string }) => input)
  .handler(
    async ({ data }) => await api().dashboardRemoveImage(cookie(), data.workspaceId, data.ref),
  );
