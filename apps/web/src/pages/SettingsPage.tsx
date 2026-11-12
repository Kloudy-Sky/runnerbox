import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Info, KeyRound, Plug, ShieldCheck } from "lucide-react";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";

const SECTIONS = [
  { to: "/settings/accounts", label: "Accounts", icon: KeyRound },
  { to: "/settings/connections", label: "Connections", icon: Plug },
  { to: "/settings/access", label: "Access", icon: ShieldCheck },
  { to: "/settings/about", label: "About", icon: Info },
] as const;

// Settings as T3 Code lays them out: a short list of sections on the left, the section on the right.
export function SettingsPage() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 px-2 pt-8" aria-label="Settings">
        {SECTIONS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            search={(previous: RootSearch) => previous}
            className={cn("flex h-8 items-center gap-2 rounded-[var(--control-radius)] px-2.5 transition-colors hover:bg-accent [&>svg]:size-4 [&>svg]:text-muted-foreground", path === to && "bg-accent")}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
