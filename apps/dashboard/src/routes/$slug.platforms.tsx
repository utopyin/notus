import {
  IconBrandGithub,
  IconBrandSlack,
  IconDotsVertical,
  IconHash,
  IconLockFilled,
  IconMessageCircleOff,
  IconPlugConnectedX,
  IconTrashFilled,
} from "@tabler/icons-react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { collectionsOf, scopeKey, type ScopeRow } from "../collections";
import { queryClient } from "../query";
import { installUrl, listScopes, uninstall, type WorkspaceView } from "../server/workspaces";
import { useWorkspace } from "./$slug";

type Installation = WorkspaceView["installations"][number];
type Platform = Installation["platform"];

/** Brand marks by the descriptor's icon key; the page never branches on the platform itself. */
const marks: Record<string, typeof IconBrandSlack> = {
  slack: IconBrandSlack,
  github: IconBrandGithub,
};
const installLabels: Record<Platform, string> = {
  slack: "Add to Slack",
  github: "Install GitHub App",
};

/**
 * The scopes an installation can see. Cached on the shared client so returning to the page shows
 * the last list at once; a fresh copy is fetched in the background once it is a few minutes old.
 */
const scopesQuery = (workspaceId: string, installation: Installation) =>
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

export const Route = createFileRoute("/$slug/platforms")({
  staticData: {
    shell: {
      active: "platforms",
      title: "Platforms",
      description:
        "Where this workspace listens for work and answers: Slack channels and GitHub repositories.",
    },
  },
  validateSearch: (search: Record<string, unknown>): { installed?: string; install?: string } => ({
    ...(typeof search.installed === "string" ? { installed: search.installed } : {}),
    ...(typeof search.install === "string" ? { install: search.install } : {}),
  }),
  // TanStack DB collections are client-side only.
  ssr: false,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return;
    const view = parent.loaderData;
    // Not awaited: each section renders its skeleton while its platform answers.
    for (const installation of view.installations)
      void queryClient.prefetchQuery(scopesQuery(view.workspace.id, installation));
    await collectionsOf(view.workspace.id).scopes.preload();
  },
  component: PlatformsPage,
});

function PlatformsPage() {
  const { view } = useWorkspace();
  const search = Route.useSearch();
  const router = useRouter();
  const isAdmin = view.role === "admin";
  const [message, setMessage] = useState<string | null>(null);
  const missing = view.installable.filter(
    (platform) => !view.installations.some((i) => i.platform === platform),
  );
  const connect = async (platform: Platform) => {
    const result = await installUrl({ data: { workspaceId: view.workspace.id, platform } });
    if (!result.ok) return setMessage(`That did not work (${result.reason}).`);
    window.location.assign(result.value.url);
  };
  const disconnect = async (installation: Installation) => {
    const result = await uninstall({
      data: {
        workspaceId: view.workspace.id,
        platform: installation.platform,
        installationId: installation.installationId,
      },
    });
    if (!result.ok) return setMessage(`That did not work (${result.reason}).`);
    await router.invalidate();
  };
  return (
    <>
      {search.installed ? (
        <p className="text-sm">
          {installLabels[search.installed as Platform]
            ? "Connected."
            : `Connected ${search.installed}.`}
        </p>
      ) : null}
      {search.install ? (
        <p className="text-destructive text-sm">Nothing was connected ({search.install}).</p>
      ) : null}
      {view.installations.length === 0 && missing.length === 0 ? (
        <p className="text-muted-foreground text-sm">No platform is connected yet.</p>
      ) : null}
      {view.installations.map((installation) => (
        <InstallationSection
          key={`${installation.platform}:${installation.installationId}`}
          view={view}
          installation={installation}
          isAdmin={isAdmin}
          onDisconnect={() => disconnect(installation)}
        />
      ))}
      {isAdmin && missing.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {missing.map((platform) => {
            const Mark = marks[platform] ?? IconBrandSlack;
            return (
              <Button key={platform} variant="outline" onClick={() => connect(platform)}>
                <Mark className="size-4" />
                {installLabels[platform]}
              </Button>
            );
          })}
        </div>
      ) : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </>
  );
}

function InstallationSection(props: {
  view: WorkspaceView;
  installation: Installation;
  isAdmin: boolean;
  onDisconnect: () => void;
}) {
  const { view, installation, isAdmin } = props;
  const { scopes } = collectionsOf(view.workspace.id);
  const { data } = useLiveQuery({
    query: (q) =>
      q
        .from({ source: scopes })
        .where(({ source }) => eq(source.installationId, installation.installationId))
        .orderBy(({ source }) => source.label, "asc"),
  });
  const { data: result } = useQuery(scopesQuery(view.workspace.id, installation), queryClient);
  // The platform's scope list once it answered, or the reason it refused.
  const available = result?.ok ? result.value.scopes : null;
  const listing = result && !result.ok ? result.reason : null;
  const loading = result === undefined;
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const byId = new Map(available?.map((c) => [c.id, c]) ?? []);
  const covered = new Set(data.map((row) => row.scope));
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
  const remove = (row: ScopeRow) => {
    scopes.delete(scopeKey(row)).isPersisted.promise.catch(report);
  };
  const options = available?.filter((c) => c.member && !covered.has(c.id)) ?? [];
  const Mark = marks[installation.icon] ?? IconBrandSlack;
  const noun = installation.scopeNoun;
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-3">
        <Mark className="text-muted-foreground size-5" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{installation.name}</span>
          <span className="text-muted-foreground truncate text-xs">{installation.label}</span>
        </div>
        {isAdmin ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${installation.name}`}>
                  <IconDotsVertical className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-max whitespace-nowrap">
              <DropdownMenuItem onClick={props.onDisconnect} className="text-destructive">
                <IconPlugConnectedX className="size-4" />
                Disconnect {installation.name}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No {noun} covered yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((row) => {
            const info = byId.get(row.scope);
            return (
              <li key={scopeKey(row)} className="flex items-center gap-3 px-4 py-3 text-sm">
                {info?.private ? (
                  <IconLockFilled className="text-muted-foreground size-4" />
                ) : (
                  <IconHash className="text-muted-foreground size-4" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {loading ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <span className="truncate leading-4 font-medium">
                      {info?.label ?? row.label ?? row.scope}
                    </span>
                  )}
                  <span className="text-muted-foreground font-mono text-xs">{row.scope}</span>
                </div>
                {isAdmin ? (
                  <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                    <IconTrashFilled className="size-4" />
                    Remove
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {isAdmin && listing === null ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`scope-${installation.installationId}`}>Add a {noun}</Label>
          <Select
            value={null}
            disabled={loading}
            onValueChange={(value: string | null) => {
              if (value) add(value);
            }}
          >
            <SelectTrigger id={`scope-${installation.installationId}`} className="w-full">
              <SelectValue placeholder={`${capitalize(noun)}s the Notus app is in…`} />
            </SelectTrigger>
            {/* Sized to its options; the popup's inset plus the item's puts the icon's ink where the trigger's text starts. */}
            <SelectContent
              alignItemWithTrigger={false}
              align="start"
              className="w-max min-w-48 p-1"
            >
              {options.length === 0 ? (
                <div className="text-muted-foreground flex items-center gap-2 py-1 pr-8 pl-1 text-sm">
                  <IconMessageCircleOff className="size-4" />
                  No {noun}s found
                </div>
              ) : (
                options.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="pl-1">
                    {c.private ? (
                      <IconLockFilled className="text-muted-foreground" />
                    ) : (
                      <IconHash className="text-muted-foreground" />
                    )}
                    {c.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Invite the app to a {noun} first if it is missing here.
          </p>
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
            {installation.name} did not list its {noun}s ({listing}); add one by its identifier.
          </p>
          <Label htmlFor={`manual-${installation.installationId}`}>{capitalize(noun)}</Label>
          <div className="flex gap-2">
            <Input
              id={`manual-${installation.installationId}`}
              className="font-mono"
              value={manual}
              onChange={(event) => setManual(event.target.value.trim())}
            />
            <Button type="submit" disabled={!manual}>
              Add
            </Button>
          </div>
        </form>
      ) : null}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </section>
  );
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
