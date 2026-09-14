import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryClient } from "./query";
import {
  addChannel,
  getWorkspace,
  removeChannel,
  revokeInvite,
  type WorkspaceView,
} from "./server/workspaces";

export type ChannelRow = WorkspaceView["channels"][number];
export type InviteRow = WorkspaceView["invites"][number];

const load = async (workspaceId: string) => {
  const result = await getWorkspace({ data: { workspaceId } });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};

/**
 * Channels and invites are edited optimistically: the row appears or disappears at once, and the
 * server call behind it either confirms or rolls it back. One pair of collections per workspace.
 */
const channelCollection = (workspaceId: string) =>
  createCollection(
    queryCollectionOptions({
      queryKey: ["workspace", workspaceId, "channels"],
      queryFn: async () => [...(await load(workspaceId)).channels],
      queryClient,
      getKey: (row: ChannelRow) => `${row.teamId}:${row.channelId}`,
      onInsert: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const row = mutation.modified;
          const result = await addChannel({
            data: { workspaceId, teamId: row.teamId, channelId: row.channelId },
          });
          if (!result.ok) throw new Error(result.reason);
        }
      },
      onDelete: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const row = mutation.original;
          const result = await removeChannel({
            data: { workspaceId, teamId: row.teamId, channelId: row.channelId },
          });
          if (!result.ok) throw new Error(result.reason);
        }
      },
    }),
  );
const inviteCollection = (workspaceId: string) =>
  createCollection(
    queryCollectionOptions({
      queryKey: ["workspace", workspaceId, "invites"],
      queryFn: async () => [...(await load(workspaceId)).invites],
      queryClient,
      getKey: (row: InviteRow) => row.id,
      // Invites are created through the server first, because the token is shown once; the row
      // is then inserted with a marker so nothing is sent twice.
      onInsert: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const metadata: unknown = mutation.metadata;
          const persisted =
            typeof metadata === "object" &&
            metadata !== null &&
            "persisted" in metadata &&
            metadata.persisted === true;
          if (!persisted) throw new Error("invites are created through createInvite");
        }
      },
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          if (mutation.changes.revokedAt === undefined) continue;
          const result = await revokeInvite({ data: { workspaceId, inviteId: mutation.key } });
          if (!result.ok) throw new Error(result.reason);
        }
      },
    }),
  );
const collections = new Map<
  string,
  { channels: ReturnType<typeof channelCollection>; invites: ReturnType<typeof inviteCollection> }
>();
export const collectionsOf = (workspaceId: string) => {
  const existing = collections.get(workspaceId);
  if (existing) return existing;
  const created = {
    channels: channelCollection(workspaceId),
    invites: inviteCollection(workspaceId),
  };
  collections.set(workspaceId, created);
  return created;
};
