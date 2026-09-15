import { IconTrashFilled } from "@tabler/icons-react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState, type FC, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { collectionsOf, scopeKey, type ScopeRow } from "../collections";
import { queryClient } from "../query";
import { listScopes, type WorkspaceView } from "../server/workspaces";

export type Installation = WorkspaceView["installations"][number];
export type ScopeSummary = {
  readonly id: string;
  readonly label: string;
  readonly member: boolean;
  readonly private: boolean;
};

/**
 * The scopes an installation can see. Cached on the shared client so returning to the page shows
 * the last list at once; a fresh copy is fetched in the background once it is a few minutes old.
 */
export const scopesQuery = (workspaceId: string, installation: Installation) =>
  queryOptions({
    queryKey: [
      "workspace",
      workspaceId,
      "scopes",
      installation.platform,
      installation.installationId,
    ],
    queryFn: () =>
      listScopes({
        data: {
          workspaceId,
          platform: installation.platform,
          installationId: installation.installationId,
        },
      }),
    staleTime: 5 * 60_000,
  });

/**
 * The scopes a workspace covers through one installation, with the picker to add more. Neutral
 * over platforms: what a scope looks like (a channel, a repository) comes from the platform's
 * `row` and `option` renderers.
 */
export const Scopes: FC<{
  view: WorkspaceView;
  installation: Installation;
  isAdmin: boolean;
  /** How the platform draws one covered scope; `info` is the platform's live view of it, once listed. */
  row: (scope: ScopeRow, info: ScopeSummary | undefined) => ReactNode;
  /** How the platform draws one pickable scope. */
  option: (scope: ScopeSummary) => ReactNode;
  /** What to tell an admin whose scope is missing from the list. */
  missingHint: string;
  /** A manual identifier's format, when the platform did not list. */
  identifierPlaceholder: string;
}> = ({ view, installation, isAdmin, row, option, missingHint, identifierPlaceholder }) => {
  const { scopes } = collectionsOf(view.workspace.id);
  const { data } = useLiveQuery({
    query: (q) =>
      q
        .from({ source: scopes })
        .where(({ source }) => eq(source.installationId, installation.installationId))
        .orderBy(({ source }) => source.label, "asc"),
  });
  const { data: result } = useQuery(scopesQuery(view.workspace.id, installation), queryClient);
  const available = result?.ok ? result.value.scopes : null;
  const listing = result && !result.ok ? result.reason : null;
  const loading = result === undefined;
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const byId = new Map(available?.map((c) => [c.id, c]) ?? []);
  const covered = new Set(data.map((s) => s.scope));
  const options = available?.filter((c) => c.member && !covered.has(c.id)) ?? [];
  const { one: noun, many: nouns } = installation.scopeNoun;
  const report = (error: unknown) =>
    setMessage(
      error instanceof Error ? `That did not work (${error.message}).` : "That did not work.",
    );
  const add = (scope: string) => {
    scopes
      .insert({
        workspaceId: view.workspace.id,
        platform: installation.platform,
        installationId: installation.installationId,
        scope,
        label: byId.get(scope)?.label ?? scope,
      })
      .isPersisted.promise.catch(report);
  };
  const remove = (scope: ScopeRow) => {
    scopes.delete(scopeKey(scope)).isPersisted.promise.catch(report);
  };
  return (
    <div className="flex flex-col gap-6">
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No {nouns} covered yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((scope) => (
            <li key={scopeKey(scope)} className="flex items-center gap-3 px-4 py-3 text-sm">
              {loading ? (
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-4 w-32" />
                  <span className="text-muted-foreground font-mono text-xs">{scope.scope}</span>
                </div>
              ) : (
                row(scope, byId.get(scope.scope))
              )}
              {isAdmin ? (
                <Button variant="ghost" size="sm" onClick={() => remove(scope)}>
                  <IconTrashFilled className="size-4" />
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && listing === null ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`scope-${installation.installationId}`}>Add a {noun}</Label>
          {/* Selecting adds at once and clears, so the box is always ready for the next one. */}
          <Combobox
            items={options}
            itemToStringLabel={(item: ScopeSummary) => item.label}
            value={null}
            disabled={loading}
            onValueChange={(item: ScopeSummary | null) => {
              if (item) add(item.id);
            }}
          >
            <ComboboxInput
              id={`scope-${installation.installationId}`}
              placeholder={loading ? "Loading…" : `Search ${nouns} the app can reach…`}
              disabled={loading}
            />
            <ComboboxContent>
              <ComboboxEmpty>No {nouns} found.</ComboboxEmpty>
              <ComboboxList>
                {(item: ScopeSummary) => (
                  <ComboboxItem key={item.id} value={item}>
                    {option(item)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <p className="text-muted-foreground text-xs">{missingHint}</p>
        </div>
      ) : null}
      {isAdmin && listing !== null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (manual) {
              add(manual);
              setManual("");
            }
          }}
        >
          <p className="text-muted-foreground text-sm">
            {installation.name} did not list its {nouns} ({listing}); add one by its identifier.
          </p>
          <Label htmlFor={`manual-${installation.installationId}`}>
            {noun.charAt(0).toUpperCase() + noun.slice(1)}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`manual-${installation.installationId}`}
              className="font-mono"
              value={manual}
              placeholder={identifierPlaceholder}
              onChange={(event) => setManual(event.target.value.trim())}
            />
            <Button type="submit" disabled={!manual}>
              Add
            </Button>
          </div>
        </form>
      ) : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </div>
  );
};
