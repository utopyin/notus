import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";

/** The API resolves the session from the forwarded cookie; the dashboard asserts nothing. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const cookie = getRequestHeader("cookie") ?? "";
  const api = Cloudflare.toRpcAsync<Api>(env.API);
  return await api.dashboardMe(cookie);
});
export type Me = NonNullable<Awaited<ReturnType<typeof getMe>>>;

export const getSessions = createServerFn({ method: "GET" }).handler(async () => {
  const cookie = getRequestHeader("cookie") ?? "";
  const api = Cloudflare.toRpcAsync<Api>(env.API);
  const result = await api.dashboardSessions(cookie);
  return result.ok ? result.value : [];
});

/** Revokes one of the user's own sessions by ID; its token never reaches the browser. */
export const revokeSession = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string }) => input)
  .handler(async ({ data }) => {
    const cookie = getRequestHeader("cookie") ?? "";
    const api = Cloudflare.toRpcAsync<Api>(env.API);
    return await api.dashboardRevokeSession(cookie, data.sessionId);
  });
