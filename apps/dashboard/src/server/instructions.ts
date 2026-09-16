import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import * as Cloudflare from "alchemy/Cloudflare/Bridge";
import type Api from "@notus/api/api";
import { env } from "../env";

const api = () => Cloudflare.toRpcAsync<Api>(env.API);
const cookie = () => getRequestHeader("cookie") ?? "";
export type InstructionKind = "role" | "repository";

export const listInstructions = createServerFn({ method: "GET" })
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => await api().dashboardInstructions(cookie(), data.workspaceId));
export type InstructionRow = Extract<
  Awaited<ReturnType<typeof listInstructions>>,
  { ok: true }
>["value"][number];

export const instructionHistory = createServerFn({ method: "GET" })
  .inputValidator((input: { workspaceId: string; kind: InstructionKind; name: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardInstructionHistory(cookie(), data.workspaceId, data.kind, data.name),
  );
export type RevisionRow = Extract<
  Awaited<ReturnType<typeof instructionHistory>>,
  { ok: true }
>["value"][number];

export const saveInstruction = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { workspaceId: string; kind: InstructionKind; name: string; body: string }) => input,
  )
  .handler(
    async ({ data }) =>
      await api().dashboardSaveInstruction(
        cookie(),
        data.workspaceId,
        data.kind,
        data.name,
        data.body,
      ),
  );

export const deleteInstruction = createServerFn({ method: "POST" })
  .inputValidator((input: { workspaceId: string; kind: InstructionKind; name: string }) => input)
  .handler(
    async ({ data }) =>
      await api().dashboardDeleteInstruction(cookie(), data.workspaceId, data.kind, data.name),
  );
