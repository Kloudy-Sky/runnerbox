import { ListIcon } from "lucide-react";
import { useState } from "react";
import type { WorkEntry } from "../../lib/threadTimeline.ts";
import { WorkLogBlock, WorkLogButton, WorkLogList } from "../chat/WorkLog.tsx";
import { WorkEntryRow } from "./WorkEntryRow.tsx";

// How many of a run's latest calls stay in view while the agent works; earlier ones wait behind
// one line, as T3 Code collapses a long run.
const SHOWN = 3;

// A running turn's calls, in a row, as they come.
export function WorkGroupRow({ entries }: { entries: ReadonlyArray<WorkEntry> }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, entries.length - SHOWN);
  return (
    <WorkLogBlock>
      <WorkLogList>
        {hidden > 0 ? (
          <WorkLogButton
            aria-expanded={false}
            onClick={() => setExpanded(true)}
            icon={<ListIcon aria-hidden className="size-4 shrink-0 stroke-2 text-icon-muted" />}
            label={<span className="block truncate text-muted-foreground">Show {hidden} more</span>}
          />
        ) : null}
        {entries.slice(hidden).map((entry) => (
          <WorkEntryRow key={entry.seq} entry={entry} />
        ))}
      </WorkLogList>
    </WorkLogBlock>
  );
}
