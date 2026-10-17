import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";
import type { Json } from "../lib/json";

const api = () => Cloudflare.toRpcAsync<Api>(env.API);
const cookie = () => getRequestHeader("cookie") ?? "";

/** The workspace's devbox configuration and the templates its admins added for one provider. */
export const getEnvironment = createServerFn({ method: "GET" })
  .inputValidator((input: { workspaceId: string; provider: string }) => input)
  .handler(
    async ({ data }) => await api().dashboardEnvironment(cookie(), data.workspaceId, data.provider),
  );
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
  .inputValidator((input: { workspaceId: string; provider: string; config: Json }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardSaveEnvironment(cookie(), data.workspaceId, data.provider, data.config),
  );

/** An admin approves a template of the workspace's own by the provider's reference. */
export const addImage = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { workspaceId: string; provider: string; ref: string; label: string }) => input,
  )
  .handler(
    async ({ data }) =>
      await api().dashboardAddImage(
        cookie(),
        data.workspaceId,
        data.provider,
        data.ref,
        data.label,
      ),
  );

export const removeImage = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; provider: string; ref: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardRemoveImage(cookie(), data.workspaceId, data.provider, data.ref),
  );

/** Null clears the workspace's default for the provider. */
export const setDefaultImage = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; provider: string; ref: string | null }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardSetDefaultImage(cookie(), data.workspaceId, data.provider, data.ref),
  );

/** An admin connects the workspace's own provider account; the response never carries the credential. */
export const connectCompute = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { workspaceId: string; provider: string; credential: Json; label: string }) => input,
  )
  .handler(
    async ({ data }) =>
      await api().dashboardConnectCompute(
        cookie(),
        data.workspaceId,
        data.provider,
        data.credential,
        data.label,
      ),
  );

export const disconnectCompute = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; provider: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardDisconnectCompute(cookie(), data.workspaceId, data.provider),
  );
