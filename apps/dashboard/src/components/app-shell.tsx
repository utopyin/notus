import {
  IconCheck,
  IconDeviceDesktopFilled,
  IconLayoutDashboardFilled,
  IconLogout,
  IconMailFilled,
  IconAppsFilled,
  IconBookFilled,
  IconMoonFilled,
  IconPlus,
  IconSelector,
  IconSettingsFilled,
  IconSunFilled,
  IconUserFilled,
} from "@tabler/icons-react";
import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "../auth-client";
import { setTheme, useTheme, type Theme } from "../theme";
import { WorkspaceMark } from "./workspace-mark";
import { PLATFORMS, slotsFor } from "../platforms";
import type { Me } from "../server/me";
import { useWorkspaces } from "../workspaces-collection";

type Current = Me["workspaces"][number];

type Active =
  | "overview"
  | "members"
  | "platforms"
  | "instructions"
  | "invites"
  | "settings"
  | "account";

/**
 * What a page under the workspace layout tells the shell about itself. No title means the
 * overview's (the workspace itself); `null` means the page draws its own header.
 */
export type ShellPage = { active: Active; title?: string | null; description?: string };

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    shell?: ShellPage;
  }
}

/**
 * The signed-in layout: a sidebar with the workspace switcher, the current workspace's pages and
 * the account menu, beside the page. Workspace-less pages pass the user's first workspace so the
 * sidebar still has somewhere to link.
 */
export function AppShell(props: {
  me: Me;
  current: Current | null;
  active?: Active;
  /** The platform page open under Platforms, when one is. */
  activePlatform?: string;
  /** `null` when the page draws its own header. */
  title: string | null;
  description?: string;
  children: ReactNode;
}) {
  const { me, active, activePlatform, title, description, children } = props;
  const router = useRouter();
  // Live rows so a rename or re-slug shows here the moment it is made.
  const workspaces = useWorkspaces(me.workspaces);
  const theme = useTheme();
  const current = props.current
    ? (workspaces.find((w) => w.id === props.current?.id) ?? props.current)
    : null;
  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/sign-in" });
  };
  const initials = me.user.name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const slug = current?.slug;
  const isAdmin = current?.role === "admin";
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="text-sm">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton size="lg" tooltip="Switch workspace">
                      {current ? (
                        <WorkspaceMark id={current.id} name={current.name} size={28} />
                      ) : (
                        <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-semibold">
                          N
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                        <span className="truncate font-medium">{current?.name ?? "Notus"}</span>
                        <span className="text-muted-foreground truncate text-xs capitalize">
                          {current ? current.role : "No workspace"}
                        </span>
                      </span>
                      <IconSelector className="ml-auto size-4 opacity-60" />
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent align="start" className="w-64">
                  {/* Base UI requires a label to live inside a group. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                    {workspaces.map((workspace) => (
                      <DropdownMenuItem
                        key={workspace.id}
                        render={<Link to="/$slug" params={{ slug: workspace.slug }} />}
                      >
                        <WorkspaceMark id={workspace.id} name={workspace.name} size={16} />
                        <span className="truncate">{workspace.name}</span>
                        {workspace.id === current?.id ? (
                          <IconCheck className="ml-auto size-4" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link to="/welcome" />}>
                    <IconPlus className="size-4" />
                    New workspace
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {slug ? (
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground [&>svg]:text-muted-foreground"
                      tooltip="Overview"
                      isActive={active === "overview"}
                      render={<Link to="/$slug" params={{ slug }} />}
                    >
                      <IconLayoutDashboardFilled />
                      <span>Overview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground [&>svg]:text-muted-foreground"
                      tooltip="Members"
                      isActive={active === "members"}
                      render={<Link to="/$slug/members" params={{ slug }} />}
                    >
                      <IconUserFilled />
                      <span>Members</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground [&>svg]:text-muted-foreground"
                      tooltip="Platforms"
                      isActive={active === "platforms" && activePlatform === undefined}
                      render={<Link to="/$slug/platforms" params={{ slug }} />}
                    >
                      <IconAppsFilled />
                      <span>Platforms</span>
                    </SidebarMenuButton>
                    {/* Every platform has a page, connected or not. Sub items are sized like the main ones and
                        span the full width, over the rail drawn down the parent's icon. */}
                    <SidebarMenuSub className="relative mx-0 mt-0.5 gap-0.5 border-0 px-0 py-0 before:absolute before:inset-y-1 before:left-[15px] before:w-px before:bg-sidebar-border">
                      {PLATFORMS.map((platform) => (
                        <SidebarMenuSubItem key={platform}>
                          <SidebarMenuSubButton
                            isActive={activePlatform === platform}
                            className="relative h-8 w-full translate-x-0 pl-8 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground"
                            render={
                              <Link to="/$slug/platforms/$platform" params={{ slug, platform }} />
                            }
                          >
                            <span>{slotsFor(platform).name}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className="font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground [&>svg]:text-muted-foreground"
                      tooltip="Instructions"
                      isActive={active === "instructions"}
                      render={<Link to="/$slug/instructions" params={{ slug }} />}
                    >
                      <IconBookFilled />
                      <span>Instructions</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {isAdmin ? (
                    <>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          className="font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground [&>svg]:text-muted-foreground"
                          tooltip="Invites"
                          isActive={active === "invites"}
                          render={<Link to="/$slug/invites" params={{ slug }} />}
                        >
                          <IconMailFilled />
                          <span>Invites</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          className="font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[active=true]:text-sidebar-foreground [&>svg]:text-muted-foreground"
                          tooltip="Settings"
                          isActive={active === "settings"}
                          render={<Link to="/$slug/settings" params={{ slug }} />}
                        >
                          <IconSettingsFilled />
                          <span>Settings</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton size="lg" tooltip={me.user.name}>
                      <Avatar className="size-8">
                        {me.user.image ? <AvatarImage src={me.user.image} alt="" /> : null}
                        <AvatarFallback>{initials || "?"}</AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                        <span className="truncate font-medium">{me.user.name}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {me.user.email}
                        </span>
                      </span>
                      <IconSelector className="ml-auto size-4 opacity-60" />
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem render={<Link to="/account" />}>
                    <IconUserFilled className="size-4" />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {theme === "dark" ? (
                        <IconMoonFilled className="size-4" />
                      ) : theme === "light" ? (
                        <IconSunFilled className="size-4" />
                      ) : (
                        <IconDeviceDesktopFilled className="size-4" />
                      )}
                      Theme
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-max">
                      <DropdownMenuRadioGroup
                        value={theme}
                        onValueChange={(value: Theme) => setTheme(value)}
                      >
                        <DropdownMenuRadioItem value="light">
                          <IconSunFilled className="size-4" />
                          Light
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">
                          <IconMoonFilled className="size-4" />
                          Dark
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="system">
                          <IconDeviceDesktopFilled className="size-4" />
                          System
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut}>
                    <IconLogout className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="flex items-center gap-2 px-4 pt-4 md:hidden">
          <SidebarTrigger />
        </div>
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
          {title === null ? null : (
            <header className="flex flex-col gap-1">
              <h1 className="text-xl font-medium tracking-tight">{title}</h1>
              {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
            </header>
          )}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
