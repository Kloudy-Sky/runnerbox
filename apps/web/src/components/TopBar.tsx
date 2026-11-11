import { Link } from "@tanstack/react-router";
import { useInbox } from "../hooks/useInbox.ts";
import { useRange } from "../hooks/useRange.ts";
import { RANGES, type Range } from "../lib/range.ts";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher.tsx";
import type { RootSearch } from "../lib/search.ts";

const TABS = [
  { to: "/inbox", label: "Inbox" },
  { to: "/runs", label: "Runs" },
  { to: "/analytics", label: "Analytics" },
  { to: "/runners", label: "Runners" },
] as const;

export function TopBar() {
  const { range } = useRange();
  const needsYou = useInbox().data?.filter((item) => item.group === "needs_you").length ?? 0;
  return (
    <header className="flex h-9 shrink-0 items-center gap-4 bg-surf px-3">
      <EnvironmentSwitcher />
      <nav className="flex items-center gap-4">
        {TABS.map((tab) => (
          <Link key={tab.to} to={tab.to} search={(previous: RootSearch) => previous} className="text-dim hover:text-fg" activeProps={{ className: "!text-fg" }}>
            {tab.label}
            {tab.to === "/inbox" && needsYou > 0 ? <span className="ml-1.5 text-amber">{needsYou}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        {(Object.keys(RANGES) as Range[]).map((option) => (
          <Link key={option} to="." search={(previous: RootSearch) => ({ ...previous, range: option })} className={option === range ? "text-fg" : "text-dim hover:text-fg"}>
            {option}
          </Link>
        ))}
      </div>
    </header>
  );
}
