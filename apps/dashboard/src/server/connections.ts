import { createServerFn } from "@tanstack/react-start";
import { call } from "./api";

export type ModelProvider = "openai-chatgpt" | "openai-api";

/** The signed-in user's model connections, as status. */
export const getConnections = createServerFn({ method: "GET" }).handler(async () => {
  const result = await call((api) => api.connections({}));
  return result.ok ? result.value : [];
});
export type Connection = Awaited<ReturnType<typeof getConnections>>[number];

/** Starts "Sign in with ChatGPT" by device code: a code to type at the verification page. */
export const beginChatGpt = createServerFn({ method: "POST" }).handler(
  async () => await call((api) => api.beginChatGpt({})),
);
/** One poll of the issuer; the login is linked once the person finished. */
export const pollChatGpt = createServerFn({ method: "POST" }).handler(
  async () => await call((api) => api.pollChatGpt({})),
);
export const linkApiKey = createServerFn({ method: "POST" })
  .validator((input: { key: string }) => input)
  .handler(async ({ data }) => await call((api) => api.linkApiKey(data)));
export const revokeConnection = createServerFn({ method: "POST" })
  .validator((input: { provider: ModelProvider }) => input)
  .handler(async ({ data }) => await call((api) => api.revokeConnection(data)));
