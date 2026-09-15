import { IconChevronRight } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
        const to = {
          to: "/$slug/platforms/$platform" as const,
          params: { slug: current.slug, platform },
        };
        return (
          <Card key={platform} className="relative transition-colors hover:bg-accent/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <slots.Mark className="text-muted-foreground size-5" />
                {/* The whole card is the link; the chevron just says so. */}
                <Link {...to} className="after:absolute after:inset-0 after:rounded-xl">
                  {slots.name}
                </Link>
                <IconChevronRight className="text-muted-foreground/60 size-3.5" />
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
          </Card>
        );
      })}
    </div>
  );
}
