import {
  IconCheck,
  IconLayoutDashboardFilled,
  IconLogout,
  IconMailFilled,
  IconMessageCircleFilled,
  IconPlus,
  IconSelector,
  IconSettingsFilled,
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
  DropdownMenuSeparator,
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
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "../auth-client";
import { WorkspaceMark } from "./workspace-mark";
import type { Me } from "../server/me";
import { useWorkspaces } from "../workspaces-collection";

type Current = Me["workspaces"][number];

type Active = "overview" | "members" | "channels" | "invites" | "settings" | "account";

/** What a page under the workspace layout tells the shell about itself. */
export type ShellPage = { active: Active; title?: string; description?: string };

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
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { me, active, title, description, children } = props;
  const router = useRouter();
  // Live rows so a rename or re-slug shows here the moment it is made.
  const workspaces = useWorkspaces(me.workspaces);
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
                <SidebarMenu>
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
                      tooltip="Channels"
                      isActive={active === "channels"}
                      render={<Link to="/$slug/channels" params={{ slug }} />}
                    >
                      <IconMessageCircleFilled />
                      <span>Channels</span>
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
          <header className="flex flex-col gap-1">
            <h1 className="text-xl font-medium tracking-tight">{title}</h1>
            {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
          </header>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
