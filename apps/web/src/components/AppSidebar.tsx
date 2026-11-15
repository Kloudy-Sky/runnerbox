import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Gauge, GitPullRequest, Inbox, ListTree, Server, Settings } from "lucide-react";
import type * as React from "react";
import { useInbox } from "../hooks/useInbox.ts";
import { useRunnerState } from "../hooks/useRunnerState.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";
import { useSidebarShortcut } from "../hooks/useSidebarShortcut.ts";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";
import { EnvironmentMenu } from "./EnvironmentMenu.tsx";
import { railFade } from "./railFade.ts";
import { SidebarUpdateSlot } from "./SidebarUpdateSlot.tsx";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar.tsx";

const keep = (previous: RootSearch) => previous;

type Page = { readonly to: "/" | "/now" | "/runs" | "/reviews" | "/speed" | "/runners" | "/settings"; readonly label: string; readonly icon: React.ComponentType; readonly count?: string | null; readonly alert?: boolean };

// One row per page, as in Codex: an icon, its name and a count. The pages' own lists live on the
// pages. Collapsed to its rail, a row keeps its icon, a tooltip and, for Needs you, a dot.
function PageRow({ page, path }: { page: Page; path: string }) {
  const Icon = page.icon;
  // An inbox item opens from Needs you, so Needs you stays the open page.
  const active = page.to === "/" ? path === "/" || path.startsWith("/item/") : path === page.to || path.startsWith(`${page.to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} tooltip={page.label} render={<Link to={page.to} search={keep} />}>
        <Icon />
        <span className={railFade}>{page.label}</span>
      </SidebarMenuButton>
      {page.count ? <span className={cn("pointer-events-none absolute top-1.5 right-2 text-muted-foreground text-xs tabular-nums", railFade)}>{page.count}</span> : null}
      {page.alert ? <span className="pointer-events-none absolute top-1.5 left-5 hidden size-1.5 rounded-full bg-destructive group-data-[collapsible=icon]:block" /> : null}
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  useSidebarShortcut();
  const inbox = useInbox().data;
  const path = useRouterState({ select: (state) => state.location.pathname });
  const installs = useRunnerState();
  const slots = installs?.filter((install) => !install.stale).flatMap((install) => install.kinds.flatMap((kind) => kind.slots)) ?? [];
  const busy = slots.filter((slot) => slot.phase === "busy").length;
  const waiting = inbox?.items.length ?? 0;
  const { reviews } = useServerCapabilities();

  const pages: ReadonlyArray<Page> = [
    { to: "/", label: "Needs you", icon: Inbox, count: waiting > 0 ? String(waiting) : null, alert: waiting > 0 },
    { to: "/now", label: "Now", icon: Activity, count: slots.length > 0 ? `${busy} of ${slots.length} busy` : null },
    { to: "/runs", label: "All runs", icon: ListTree },
    // Left out on a server older than reviews, which would have nothing to show.
    ...(reviews ? [{ to: "/reviews", label: "Reviews", icon: GitPullRequest } as const] : []),
    { to: "/speed", label: "Speed and cost", icon: Gauge },
    { to: "/runners", label: "Runners", icon: Server },
  ];

  return (
    // A raised surface with no border, like Codex's.
    <Sidebar aria-label="Navigation" collapsible="icon" className="group-data-[side=left]:border-r-0">
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {pages.map((page) => (
              <PageRow key={page.to} page={page} path={path} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <PageRow page={{ to: "/settings", label: "Settings", icon: Settings }} path={path} />
        </SidebarMenu>
        <SidebarUpdateSlot />
        <SidebarMenu>
          <SidebarMenuItem>
            <EnvironmentMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
