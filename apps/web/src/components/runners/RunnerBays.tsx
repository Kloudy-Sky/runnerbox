import type { RunnerTile } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";
import { READY_OR_RUNNING, runnerPhase } from "../../lib/runnerWords.ts";
import { cn } from "../../lib/utils.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import { STEPPED_ASIDE_STRIPES } from "./steppedAside.ts";

// How each state draws its bay, and its word under the bay. A running bay is full: how far a job
// is toward its usual time isn't known reliably, so no bay claims it.
const BAY: Record<RunnerTile["state"], { bay: string; word: string; tone: string }> = {
  running: { bay: "bg-foreground/85", word: "running", tone: "text-foreground" },
  maybe_running: { bay: "bg-foreground/30", word: "ready or busy", tone: "text-muted-foreground" },
  ready: { bay: "bg-foreground/[0.06]", word: "ready", tone: "text-muted-foreground" },
  stepped_aside: { bay: "bg-foreground/[0.04]", word: "stepped aside", tone: "text-warning" },
  starting: { bay: "border border-dashed border-foreground/25", word: "starting", tone: "text-muted-foreground" },
  retrying: { bay: "border border-destructive/70", word: "failing to start", tone: "text-destructive" },
  stopped: { bay: "border border-foreground/15", word: "stopped", tone: "text-muted-foreground" },
};

// Work and waiting on memory are worth timing; the rest just are.
const TIMED = new Set<RunnerTile["state"]>(["running", "stepped_aside"]);

// Every runner as a tall bay: full while it runs a job, striped while it stands aside for memory,
// outlined red while it fails to start. Hovering says what it's doing and, when the machine gave
// one, why.
export function RunnerBays({ runners, now }: { runners: ReadonlyArray<RunnerTile>; now: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-x-2 gap-y-3">
      {runners.map((tile) => {
        const look = BAY[tile.state];
        const words = tile.state === "maybe_running" ? READY_OR_RUNNING : runnerPhase(tile.phase, tile.job);
        return (
          <Tooltip key={`${tile.kind}-${tile.slot}`}>
            <TooltipTrigger
              render={
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className={cn("h-20", look.bay)} style={tile.state === "stepped_aside" ? STEPPED_ASIDE_STRIPES : undefined} />
                  <div className="flex min-w-0 flex-col text-xs leading-snug">
                    <span className={cn("truncate font-medium", look.tone)}>{tile.state === "running" && tile.job ? tile.job : look.word}</span>
                    <span className="truncate text-muted-foreground">
                      {tile.kind} {tile.slot}
                      {TIMED.has(tile.state) ? <span className="tabular-nums">, {formatDuration(now - Date.parse(tile.since))}</span> : null}
                    </span>
                  </div>
                </div>
              }
            />
            <TooltipPopup side="top">
              {words.text}
              {tile.why ? `. ${tile.why}` : ""}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
