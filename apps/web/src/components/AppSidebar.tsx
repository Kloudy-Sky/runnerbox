import type { InboxItem } from "@runnerbox/contracts";
import { Button } from "./ui/button.tsx";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Gauge, ListTree, Server, Settings } from "lucide-react";
import { useDesktopUpdates } from "../hooks/useDesktopUpdates.ts";
import { useInbox } from "../hooks/useInbox.ts";
import { useMonitors } from "../hooks/useMonitors.ts";
import { useRunnerState } from "../hooks/useRunnerState.ts";
import { formatAge } from "../lib/format.ts";
import type { RootSearch } from "../lib/search.ts";
import { EnvironmentMenu } from "./EnvironmentMenu.tsx";
import { RangePicker } from "./RangePicker.tsx";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { Kbd } from "./ui/kbd.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar.tsx";

const keep = (previous: RootSearch) => previous;

// The views to browse first, then what needs the owner and what's worth watching, like T3 Code's
// list of threads: each item shows its state without opening it.
export function AppSidebar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const inbox = useInbox().data;
  const updates = useDesktopUpdates();
  const unread = new Set(useMonitors().status?.unread ?? []);
  const path = useRouterState({ select: (state) => state.location.pathname });
  const installs = useRunnerState();
  const slots = installs?.filter((install) => !install.stale).flatMap((install) => install.kinds.flatMap((kind) => kind.slots)) ?? [];
  const busy = slots.filter((slot) => slot.phase === "busy").length;
  // The route's own param, so the open item is found whatever the URL's encoding of its id.
  const { itemId } = useParams({ strict: false });
  const isOpen = (item: InboxItem) => item.id === itemId;

  const browse = [
    { to: "/runs", label: "All runs", icon: ListTree },
    { to: "/speed", label: "Speed and cost", icon: Gauge },
    { to: "/runners", label: "Runners", icon: Server, badge: slots.length > 0 ? `${busy} of ${slots.length} busy` : null },
    { to: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <Sidebar aria-label="Navigation">
      <SidebarHeader>
        <EnvironmentMenu />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Browse</SidebarGroupLabel>
          <SidebarMenu>
            {browse.map(({ to, label, icon: Icon, ...rest }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton isActive={path === to || path.startsWith(`${to}/`)} render={<Link to={to} search={keep} />}>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
                {"badge" in rest && rest.badge ? <SidebarMenuBadge>{rest.badge}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>
            <Link to="/" search={keep} className="hover:text-foreground">
              Needs you
            </Link>
          </SidebarGroupLabel>
          <SidebarMenu>
            {inbox && inbox.items.length === 0 ? <li className="px-2.5 py-1 text-muted-foreground">Nothing right now.</li> : null}
            {inbox?.items.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton size="lg" isActive={isOpen(item)} render={<Link to="/item/$itemId" params={{ itemId: item.id }} search={keep} />}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" />
                      <span className="line-clamp-2">{item.title}</span>
                    </span>
                    {unread.has(item.id) ? <span className="block pl-3.5 text-muted-foreground text-xs">Looked into</span> : null}
                  </span>
                  <span className="shrink-0 pt-px text-muted-foreground text-xs">{formatAge(item.at)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {inbox && inbox.quiet.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Watching</SidebarGroupLabel>
            <SidebarMenu>
              {inbox.quiet.map((group) => (
                <SidebarMenuItem key={group.kind}>
                  <Collapsible defaultOpen={group.items.some(isOpen)}>
                    <SidebarMenuButton render={<CollapsibleTrigger />} className="group/trigger">
                      <ChevronRight className="transition-transform duration-150 group-data-panel-open/trigger:rotate-90" />
                      {group.kind === "flaky" ? <span className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
                      <span>{group.title}</span>
                    </SidebarMenuButton>
                    <CollapsiblePanel>
                      <SidebarMenu className="py-0.5 pl-6">
                        {group.items.map((item) => (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton isActive={isOpen(item)} render={<Link to="/item/$itemId" params={{ itemId: item.id }} search={keep} />}>
                              <span className="text-muted-foreground">{item.title}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </CollapsiblePanel>
                  </Collapsible>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        {updates?.state.status === "ready" ? (
          <Button variant="ghost" size="xs" className="justify-start" title={`runnerbox ${updates.state.pending ?? ""} is downloaded`} onClick={() => void updates.actions.install()}>
            Restart to update
          </Button>
        ) : null}
        <div className="flex items-center justify-between">
          <RangePicker />
          <Button variant="ghost-muted" size="xs" onClick={onOpenCommand} aria-label="Jump to a page, item or run" title="Jump to a page, item or run">
            <Kbd>⌘K</Kbd>
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
