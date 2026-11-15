import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import { useStore } from "zustand";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { activeRoute } from "../lib/routes.ts";
import { cn } from "../lib/utils.ts";
import { runtime } from "../runtime.ts";
import type { RootSearch } from "../lib/search.ts";
import { usePreferences } from "../state/preferences.ts";
import { useRestarting } from "../state/serverUpdates.ts";
import { ConnectionState } from "./ConnectionState.tsx";
import { railFade } from "./railFade.ts";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu.tsx";
import { SidebarMenuButton, useSidebar } from "./ui/sidebar.tsx";
import { UserAvatar } from "./UserAvatar.tsx";

// The sidebar's bottom row, as in Codex: the account's avatar beside the environment this window
// shows and how it's connected, with the other environments a click away. In the rail only the
// avatar stays.
export function EnvironmentMenu() {
  const { environment, connection } = useActiveEnvironment();
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const restarting = useRestarting();
  const setActive = usePreferences((state) => state.setActive);
  const navigate = useNavigate();
  const { state } = useSidebar();
  const route = environment ? activeRoute(environment, connection) : undefined;
  return (
    <Menu>
      <MenuTrigger
        render={<SidebarMenuButton size="lg" className="h-11 px-1.5 group-data-[collapsible=icon]:p-1! data-popup-open:bg-sidebar-row-hover" aria-label="Environments and account" />}
      >
        <UserAvatar />
        <span className={cn("min-w-0 flex-1", railFade)}>
          <span className="block truncate font-medium text-sidebar-foreground">{environment?.label ?? "No environment"}</span>
          {environment ? <ConnectionState connection={connection} route={route} restarting={restarting.has(environment.environmentId)} className="max-w-full truncate font-normal text-xs" /> : null}
        </span>
        <ChevronsUpDown className={railFade} />
      </MenuTrigger>
      <MenuPopup className="w-64" side={state === "collapsed" ? "right" : "top"} align="start">
        <MenuGroup>
          <MenuGroupLabel>Environments</MenuGroupLabel>
          {environments.map((saved) => (
            <MenuItem key={saved.environmentId} onClick={() => setActive(saved.environmentId)}>
              <span className={saved.environmentId === environment?.environmentId ? "flex-1 font-medium" : "flex-1"}>{saved.label}</span>
              <ConnectionState connection={connections[saved.environmentId]} restarting={restarting.has(saved.environmentId)} className="text-xs" />
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuItem onClick={() => void navigate({ to: "/settings/connections", search: (previous: RootSearch) => previous })}>Add or manage environments</MenuItem>
      </MenuPopup>
    </Menu>
  );
}
