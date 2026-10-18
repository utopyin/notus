import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useSyncExternalStore } from "react";
import { queryClient } from "./query";
import { getMe, type Me } from "./server/me";
import { updateWorkspace } from "./server/workspaces";

export type WorkspaceRow = Me["workspaces"][number];

/**
 * The signed-in user's workspaces, shared by the sidebar switcher and the settings page. Renames
 * and re-slugs apply optimistically everywhere at once; the server call behind them confirms or
 * rolls back. Created lazily so nothing runs during server rendering.
 */
let collection: ReturnType<typeof make> | null = null;

const make = () =>
  createCollection(
    queryCollectionOptions({
      queryKey: ["workspaces"],
      queryFn: async () => {
        const me = await getMe();
        return me ? [...me.workspaces] : [];
      },
      queryClient,
      getKey: (row: WorkspaceRow) => row.id,
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const result = await updateWorkspace({
            data: {
              workspaceId: mutation.key,
              name: mutation.changes.name,
              slug: mutation.changes.slug,
            },
          });

          if (!result.ok) throw new Error(result.reason);
        }
      },
    }),
  );

export const workspacesCollection = () => {
  collection ??= make();
  return collection;
};

/** The rows as of the last change, kept so a re-render without a change reads the same array. */
let snapshot: ReadonlyArray<WorkspaceRow> | null = null;

const subscribe = (onChange: () => void) => {
  const live = workspacesCollection();

  void live.preload();

  const subscription = live.subscribeChanges(
    () => {
      snapshot = live.toArray;
      onChange();
    },
    { includeInitialState: true },
  );

  return () => subscription.unsubscribe();
};

/** Live workspaces on the client; the loader's snapshot on the server and until the first sync. */
export const useWorkspaces = (initial: ReadonlyArray<WorkspaceRow>) =>
  useSyncExternalStore(
    subscribe,
    () => snapshot ?? initial,
    () => initial,
  );
