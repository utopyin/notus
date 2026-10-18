import { createServerFn } from "@tanstack/react-start";
import { call } from "./api";

/** The API resolves the session from the forwarded cookie; the dashboard asserts nothing. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const result = await call((api) => api.me());
  return result.ok ? result.value : null;
});
export type Me = NonNullable<Awaited<ReturnType<typeof getMe>>>;

export const getSessions = createServerFn({ method: "GET" }).handler(async () => {
  const result = await call((api) => api.sessions({}));
  return result.ok ? result.value : [];
});

/** Revokes one of the user's own sessions by ID; its token never reaches the browser. */
export const revokeSession = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.revokeSession(data)));
