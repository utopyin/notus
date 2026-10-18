import { createServerFn } from "@tanstack/react-start";
import type { Json } from "../lib/json";
import { call } from "./api";

/**
 * The workspace's devbox configuration, its templates and its account for one provider: the one
 * asked for, else the one the workspace runs on.
 */
export const getEnvironment = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string; provider: string | null }) => input)
  .handler(async ({ data }) => await call((api) => api.environment(data)));
export type EnvironmentView = Extract<
  Awaited<ReturnType<typeof getEnvironment>>,
  { ok: true }
>["value"];

export const environmentHistory = createServerFn({ method: "GET" })
  .validator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await call((api) => api.environmentHistory(data)));
export type EnvironmentRevision = Extract<
  Awaited<ReturnType<typeof environmentHistory>>,
  { ok: true }
>["value"][number];

/** The provider's policy validates the document before it is stored; a refusal carries its message. */
export const saveEnvironment = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; provider: string; config: Json }) => input)
  .handler(async ({ data }) => await call((api) => api.saveEnvironment(data)));

/** An admin approves a template of the workspace's own by the provider's reference. */
export const addImage = createServerFn({ method: "POST" })
  .validator(
    (input: { workspaceId: string; provider: string; ref: string; label: string }) => input,
  )
  .handler(async ({ data }) => await call((api) => api.addImage(data)));

export const removeImage = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; provider: string; ref: string }) => input)
  .handler(async ({ data }) => await call((api) => api.removeImage(data)));

/** Null clears the workspace's default for the provider. */
export const setDefaultImage = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; provider: string; ref: string | null }) => input)
  .handler(async ({ data }) => await call((api) => api.setDefaultImage(data)));

/** An admin connects the workspace's own provider account; the response never carries the credential. */
export const connectCompute = createServerFn({ method: "POST" })
  .validator(
    (input: { workspaceId: string; provider: string; credential: Json; label: string }) => input,
  )
  .handler(async ({ data }) => await call((api) => api.connectCompute(data)));

export const disconnectCompute = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; provider: string }) => input)
  .handler(async ({ data }) => await call((api) => api.disconnectCompute(data)));

/** An admin builds the Notus template again in the workspace's account; a running build is reported. */
export const buildTemplate = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; provider: string }) => input)
  .handler(async ({ data }) => await call((api) => api.buildTemplate(data)));
