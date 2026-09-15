import { IconDotsVertical, IconPlugConnectedX } from "@tabler/icons-react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collectionsOf } from "../collections";
import { isPlatform, slotsFor } from "../platforms";
import { scopesQuery } from "../platforms/scopes";
import { queryClient } from "../query";
import { installUrl, uninstall } from "../server/workspaces";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/platforms/$platform")({
  // The page's own header names the platform; the shell adds none.
  staticData: { shell: { active: "platforms", title: null } },
  validateSearch: (search: Record<string, unknown>): { installed?: string; install?: string } => ({
    ...(typeof search.installed === "string" ? { installed: search.installed } : {}),
    ...(typeof search.install === "string" ? { install: search.install } : {}),
  }),
  // TanStack DB collections are client-side only.
  ssr: false,
  loader: async ({ params, parentMatchPromise }) => {
    if (!isPlatform(params.platform)) throw notFound();
    const parent = await parentMatchPromise;
    if (!parent.loaderData) return;
    const view = parent.loaderData;
    const installation = view.installations.find((i) => i.platform === params.platform);
    // Not awaited: the page renders its skeleton while the platform answers.
    if (installation) void queryClient.prefetchQuery(scopesQuery(view.workspace.id, installation));
    await collectionsOf(view.workspace.id).scopes.preload();
  },
  component: PlatformPage,
});

function PlatformPage() {
  const { view } = useWorkspace();
  const { platform } = Route.useParams();
  const search = Route.useSearch();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (!isPlatform(platform)) return null;
  const slots = slotsFor(platform);
  const installation = view.installations.find((i) => i.platform === platform) ?? null;
  const isAdmin = view.role === "admin";
  const connect = async () => {
    const result = await installUrl({ data: { workspaceId: view.workspace.id, platform } });
    if (!result.ok) return setMessage(`That did not work (${result.reason}).`);
    window.location.assign(result.value.url);
  };
  const disconnect = async () => {
    if (!installation) return;
    const result = await uninstall({
      data: {
        workspaceId: view.workspace.id,
        platform,
        installationId: installation.installationId,
      },
    });
    if (!result.ok) return setMessage(`That did not work (${result.reason}).`);
    await router.invalidate();
  };
  return (
    <>
      {/* Sized like the shell's page header, which this page replaces. */}
      <header className="flex items-center gap-3">
        <slots.Mark className="text-muted-foreground size-7" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">{slots.name}</h1>
          <span className="text-muted-foreground truncate text-sm">
            {installation ? `Connected · ${installation.label}` : "Not connected"}
          </span>
        </div>
        {isAdmin && installation ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${slots.name}`}>
                  <IconDotsVertical className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-max whitespace-nowrap">
              <DropdownMenuItem onClick={disconnect} className="text-destructive">
                <IconPlugConnectedX className="size-4" />
                Disconnect {slots.name}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      {search.installed ? <p className="text-sm">Connected.</p> : null}
      {search.install ? (
        <p className="text-destructive text-sm">Nothing was connected ({search.install}).</p>
      ) : null}
      {installation ? (
        <slots.Details view={view} installation={installation} isAdmin={isAdmin} />
      ) : isAdmin && view.installable.includes(platform) ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">{slots.description}</p>
          <Button variant="outline" onClick={connect}>
            <slots.Mark className="size-4" />
            {slots.installLabel}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {view.installable.includes(platform)
            ? "An admin can connect this platform."
            : "This deployment cannot connect this platform."}
        </p>
      )}
      {message ? <p className="text-destructive text-sm">{message}</p> : null}
    </>
  );
}
