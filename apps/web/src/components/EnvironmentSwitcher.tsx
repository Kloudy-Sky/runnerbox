import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "zustand";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { routeKind } from "../lib/routes.ts";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";
import { ConnectionState } from "./ConnectionState.tsx";
import type { RootSearch } from "../lib/search.ts";

export function EnvironmentSwitcher() {
  const [open, setOpen] = useState(false);
  const { environment, connection } = useActiveEnvironment();
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const setActive = usePreferences((state) => state.setActive);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 bg-surf2 px-2 py-0.5">
        {environment ? (
          <>
            <span>{environment.label}</span>
            <span className="text-dim">{routeKind(environment.route)}</span>
            <ConnectionState connection={connection} />
          </>
        ) : (
          <span className="text-dim">No environment</span>
        )}
      </button>
      {open ? (
        <div className="absolute top-7 left-0 z-10 min-w-64 bg-surf2 py-1 shadow-lg shadow-black/50">
          {environments.map((saved) => (
            <button
              type="button"
              key={saved.environmentId}
              onClick={() => {
                setActive(saved.environmentId);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-surf ${saved.environmentId === environment?.environmentId ? "text-fg" : "text-dim"}`}
            >
              <span className="flex-1">{saved.label}</span>
              <span className="text-dim">{routeKind(saved.route)}</span>
              <ConnectionState connection={connections[saved.environmentId]} />
            </button>
          ))}
          <Link to="/connect" search={(previous: RootSearch) => previous} onClick={() => setOpen(false)} className="block px-3 py-1 text-dim hover:bg-surf hover:text-fg">
            Add or manage environments
          </Link>
        </div>
      ) : null}
    </div>
  );
}
