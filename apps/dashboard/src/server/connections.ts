import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare";
import type Api from "../../../api/src/api";
import { env } from "../env";

const cookie = () => getRequestHeader("cookie") ?? "";
const api = () => Cloudflare.toRpcAsync<Api>(env.API);

export type ModelProvider = "openai-chatgpt" | "openai-api";

/** The signed-in user's model connections: status projections, never material. */
export const getConnections = createServerFn({ method: "GET" }).handler(async () => {
  const result = await api().dashboardConnections(cookie());
  return result.ok ? result.value : [];
});
export type Connection = Awaited<ReturnType<typeof getConnections>>[number];

/** Starts "Sign in with ChatGPT" by device code: a code to type at the verification page. */
export const beginChatGpt = createServerFn({ method: "POST" }).handler(
  async () => await api().dashboardBeginChatGpt(cookie()),
);
/** One poll of the issuer; the login is linked once the person finished. */
export const pollChatGpt = createServerFn({ method: "POST" }).handler(
  async () => await api().dashboardPollChatGpt(cookie()),
);
export const linkApiKey = createServerFn({ method: "POST" })
  .inputValidator((input: { key: string }) => input)
  .handler(async ({ data }) => await api().dashboardLinkApiKey(cookie(), data.key));
export const revokeConnection = createServerFn({ method: "POST" })
  .inputValidator((input: { provider: ModelProvider }) => input)
  .handler(async ({ data }) => await api().dashboardRevokeConnection(cookie(), data.provider));
