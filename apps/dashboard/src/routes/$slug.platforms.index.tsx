import { IconSettingsFilled } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORMS, slotsFor } from "../platforms";
import { useWorkspace } from "./$slug";

export const Route = createFileRoute("/$slug/platforms/")({
  staticData: {
    shell: {
      active: "platforms",
      title: "Platforms",
      description: "Where this workspace listens for work and answers.",
    },
  },
  component: Platforms,
});

function Platforms() {
  const { view, current } = useWorkspace();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PLATFORMS.map((platform) => {
        const slots = slotsFor(platform);
        const installation = view.installations.find((i) => i.platform === platform) ?? null;
        const scopes = view.scopes.filter((s) => s.platform === platform).length;
        const to = {
          to: "/$slug/platforms/$platform" as const,
          params: { slug: current.slug, platform },
        };
        return (
          <Card key={platform} className="relative transition-colors hover:bg-accent/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <slots.Mark className="text-muted-foreground size-5" />
                {/* The whole card is the link; the button below is the same destination for the pointer. */}
                <Link {...to} className="after:absolute after:inset-0 after:rounded-xl">
                  {slots.name}
                </Link>
              </CardTitle>
              {/* Connection state: a dot beside the identity the platform knows us by. */}
              <CardAction className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className={
                    installation
                      ? "size-1.5 rounded-full bg-emerald-500"
                      : "size-1.5 rounded-full bg-muted-foreground/40"
                  }
                />
                {installation
                  ? installation.label
                  : view.installable.includes(platform)
                    ? "Not connected"
                    : "Unavailable"}
              </CardAction>
            </CardHeader>
            <CardContent>
              <CardDescription>{slots.description}</CardDescription>
            </CardContent>
            <CardFooter className="items-end justify-between px-4 py-2">
              <span className="text-muted-foreground text-xs">
                {installation
                  ? `${scopes} ${scopes === 1 ? installation.scopeNoun.one : installation.scopeNoun.many} covered`
                  : ""}
              </span>
              <Button variant="outline" size="sm" className="relative" render={<Link {...to} />}>
                <IconSettingsFilled className="size-4" />
                Configure
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
