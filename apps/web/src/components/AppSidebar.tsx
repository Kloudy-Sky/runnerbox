import { isInboxItemHidden } from "@runnerbox/contracts";
import { Link, useRouterState } from "@tanstack/react-router";
import { Gauge, GitPullRequest, Inbox, LayoutDashboard, ListTree, Server, Settings } from "lucide-react";
import type * as React from "react";
import { useRange } from "../hooks/useRange.ts";
import { useRpcQueryEverywhere } from "../hooks/useRpcQueryEverywhere.ts";
import { useAtomValue } from "@effect/atom-react";
import { runnerStateEverywhereAtom } from "../state/runnerMachines.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";
import { useSidebarShortcut } from "../hooks/useSidebarShortcut.ts";
import { needsYouEverywhere } from "../lib/needsYouEverywhere.ts";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";
import { EnvironmentMenu } from "./EnvironmentMenu.tsx";
import { railFade } from "./railFade.ts";
import { SidebarUpdateSlot } from "./SidebarUpdateSlot.tsx";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar.tsx";

const keep = (previous: RootSearch) => previous;

type Page = { readonly to: "/" | "/inbox" | "/runs" | "/pulls" | "/speed" | "/runners" | "/settings"; readonly label: string; readonly icon: React.ComponentType; readonly count?: string | null; readonly alert?: boolean };

// One row per page, as in Codex: an icon, its name and a count. The pages' own lists live on the
// pages. Collapsed to its rail, a row keeps its icon, a tooltip and, for Inbox, a dot.
function PageRow({ page, path }: { page: Page; path: string }) {
  const Icon = page.icon;
  // Overview, at "/", is active only there.
  const active = path === page.to || (page.to !== "/" && path.startsWith(`${page.to}/`));
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

// The counts cover every connected machine, not only the one picked in the switcher.
export function AppSidebar() {
  useSidebarShortcut();
  const { days } = useRange();
  const inboxes = useRpcQueryEverywhere(["inbox", days], (client) => client["inbox.list"]({ days }));
  const path = useRouterState({ select: (state) => state.location.pathname });
  const machines = useAtomValue(runnerStateEverywhereAtom);
  const slots = [...machines.values()].flat().filter((install) => !install.stale).flatMap((install) => install.kinds.flatMap((kind) => kind.slots));
  const busy = slots.filter((slot) => slot.phase === "busy").length;
  const waiting = needsYouEverywhere(inboxes.map((answer) => ({ environmentId: answer.environment.environmentId, inbox: answer.data }))).filter((item) => !isInboxItemHidden(item)).length;
  const { reviews } = useServerCapabilities();

  const pages: ReadonlyArray<Page> = [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/inbox", label: "Inbox", icon: Inbox, count: waiting > 0 ? String(waiting) : null, alert: waiting > 0 },
    { to: "/runners", label: "Runners", icon: Server, count: slots.length > 0 ? `${busy} of ${slots.length} busy` : null },
    { to: "/runs", label: "All runs", icon: ListTree },
    // Left out on a server older than reviews, which would have nothing to show.
    ...(reviews ? [{ to: "/pulls", label: "Pull requests", icon: GitPullRequest } as const] : []),
    { to: "/speed", label: "Speed and cost", icon: Gauge },
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
