import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type { WorkEntry } from "../../lib/threadTimeline.ts";
import { WorkLogBlock, WorkLogList } from "../chat/WorkLog.tsx";
import { WorkEntryRow } from "./WorkEntryRow.tsx";

// A finished turn's work, folded under one line saying how long it took, as T3 Code's turn fold.
// A turn with no work to show has the line alone.
export function TurnFoldRow({ label, entries }: { label: string; entries: ReadonlyArray<WorkEntry> }) {
  const [expanded, setExpanded] = useState(false);
  const foldable = entries.length > 0;
  return (
    <div className="border-b border-border/60 pt-1 pb-2 pe-0.5">
      {foldable ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          {label}
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        </button>
      ) : (
        <p className="px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">{label}</p>
      )}
      {expanded ? (
        <div className="pt-1">
          <WorkLogBlock layout="group-content">
            <WorkLogList>
              {entries.map((entry) => (
                <WorkEntryRow key={entry.seq} entry={entry} />
              ))}
            </WorkLogList>
          </WorkLogBlock>
        </div>
      ) : null}
    </div>
  );
}
