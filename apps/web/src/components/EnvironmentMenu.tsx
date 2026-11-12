import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import { useStore } from "zustand";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { activeRoute } from "../lib/routes.ts";
import { runtime } from "../runtime.ts";
import type { RootSearch } from "../lib/search.ts";
import { usePreferences } from "../state/preferences.ts";
import { ConnectionState } from "./ConnectionState.tsx";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu.tsx";

// The environment this window shows, how it's reached and whether it's connected, with the others
// a click away.
export function EnvironmentMenu() {
  const { environment, connection } = useActiveEnvironment();
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const setActive = usePreferences((state) => state.setActive);
  const navigate = useNavigate();
  const route = environment ? activeRoute(environment, connection) : undefined;
  return (
    <Menu>
      <MenuTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-2.5 py-1.5 text-left outline-none hover:bg-sidebar-row-hover data-popup-open:bg-sidebar-row-hover">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{environment?.label ?? "No environment"}</span>
          {environment ? (
            <span className="flex items-center gap-2 text-xs">
              <ConnectionState connection={connection} route={route} />
            </span>
          ) : null}
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup className="w-64">
        <MenuGroup>
          <MenuGroupLabel>Environments</MenuGroupLabel>
          {environments.map((saved) => (
            <MenuItem key={saved.environmentId} onClick={() => setActive(saved.environmentId)}>
              <span className={saved.environmentId === environment?.environmentId ? "flex-1 font-medium" : "flex-1"}>{saved.label}</span>
              <ConnectionState connection={connections[saved.environmentId]} className="text-xs" />
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuItem onClick={() => void navigate({ to: "/settings/connections", search: (previous: RootSearch) => previous })}>Add or manage environments</MenuItem>
      </MenuPopup>
    </Menu>
  );
}
