import { ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import type { WorkEntry } from "../../lib/threadTimeline.ts";
import { toolPhrase } from "../../lib/toolPhrases.ts";
import { TimelineRowTimestamp } from "../chat/TimelineRowParts.tsx";
import { WorkLogDetails, WorkLogRow } from "../chat/WorkLog.tsx";
import { toolIcon } from "./toolIcon.ts";

const failed = (entry: WorkEntry) => entry._tag === "ReproduceCommand" && (entry.timedOut || entry.exitCode !== 0);

// One thing the agent did, as T3 Code's work row: its icon, a plain line, and on click what it
// really was: the raw call, or the command's output.
export function WorkEntryRow({ entry }: { entry: WorkEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = toolIcon(entry);
  const toggle = () => setExpanded((open) => !open);
  return (
    <WorkLogRow
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      }}
      icon={<Icon aria-hidden className="block size-4 shrink-0 stroke-2 text-icon-muted" />}
      label={
        entry._tag === "ReproduceCommand" ? (
          <span className="font-mono text-xs text-foreground">$ {entry.command}</span>
        ) : (
          toolPhrase(entry.name)
        )
      }
      trailing={
        <>
          {entry._tag === "ReproduceCommand" ? (
            <span className={cn("shrink-0 text-xs tabular-nums", failed(entry) ? "text-destructive" : "text-muted-foreground")}>
              {entry.timedOut ? "timed out" : `exit ${entry.exitCode ?? "?"}`}
            </span>
          ) : null}
          {failed(entry) ? <XIcon aria-hidden className="size-3 shrink-0 text-destructive" /> : null}
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
            <ChevronRightIcon className={cn("size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200", expanded && "rotate-90")} />
          </span>
          <TimelineRowTimestamp createdAt={entry.at} timestampFormat="locale" />
        </>
      }
    >
      {expanded ? (
        <WorkLogDetails>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
            {entry._tag === "ReproduceCommand"
              ? `${entry.truncated ? "(earlier output cut)\n" : ""}${entry.output === "" ? "(no output)" : entry.output}`
              : `${entry.name} ${entry.input === "{}" ? "" : entry.input}`}
          </pre>
        </WorkLogDetails>
      ) : null}
    </WorkLogRow>
  );
}
