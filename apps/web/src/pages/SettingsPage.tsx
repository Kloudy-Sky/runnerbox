import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, Eye, GitBranch, GitPullRequest, Info, KeyRound, Plug, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { handleSettingsSectionKeyDown } from "../components/settings/settingsSectionNavigation.ts";
import { SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar.tsx";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator } from "../components/WorkspaceBreadcrumb.tsx";
import type { RootSearch } from "../lib/search.ts";

const SECTIONS = [
  { to: "/settings/providers", label: "Providers", icon: KeyRound },
  { to: "/settings/connections", label: "Connections", icon: Plug },
  { to: "/settings/github", label: "GitHub", icon: GitBranch },
  { to: "/settings/access", label: "Access", icon: ShieldCheck },
  { to: "/settings/changes", label: "Changes", icon: SlidersHorizontal },
  { to: "/settings/monitors", label: "Monitors", icon: Eye },
  { to: "/settings/reviews", label: "Reviews", icon: GitPullRequest },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/about", label: "About", icon: Info },
] as const;

// Settings as T3 Code lays them out: the sections in a rail on the left, arrow keys moving between
// them, and the open one on the right under a breadcrumb.
export function SettingsPage() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const current = SECTIONS.find((section) => section.to === path);
  return (
    <div className="relative flex min-h-0 flex-1">
      <nav aria-label="Settings sections" className="flex w-60 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground max-md:w-14">
        <SidebarContent className="overflow-x-hidden">
          <SidebarGroup>
            <SidebarMenu onKeyDown={handleSettingsSectionKeyDown}>
              {SECTIONS.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    data-settings-section={to}
                    aria-current={path === to ? "page" : undefined}
                    isActive={path === to}
                    render={<Link to={to} search={(previous: RootSearch) => previous} />}
                  >
                    <Icon />
                    <span className="truncate max-md:sr-only">{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
          <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
            {current ? (
              <>
                <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
                <WorkspaceBreadcrumbSeparator />
              </>
            ) : null}
            <WorkspaceBreadcrumbItem current className="truncate">
              {current?.label ?? "Settings"}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
