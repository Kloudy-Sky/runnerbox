import { Link } from "@tanstack/react-router";
import { useRange } from "../hooks/useRange.ts";
import { RANGES, type Range } from "../lib/range.ts";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";

const LABELS: Record<Range, string> = { "1d": "Day", "7d": "Week", "30d": "Month" };

// The window every view counts over.
export function RangePicker() {
  const { range } = useRange();
  return (
    <div className="flex gap-1 px-2.5 text-xs" role="group" aria-label="Time range">
      {(Object.keys(RANGES) as Range[]).map((option) => (
        <Link
          key={option}
          to="."
          search={(previous: RootSearch) => ({ ...previous, range: option })}
          className={cn("rounded-md px-1.5 py-0.5 transition-colors", option === range ? "bg-sidebar-row-selected text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {LABELS[option]}
        </Link>
      ))}
    </div>
  );
}
