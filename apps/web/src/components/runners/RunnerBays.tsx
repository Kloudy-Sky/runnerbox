import type { RunnerTile, RunningJob } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";
import { READY_OR_RUNNING, runnerPhase } from "../../lib/runnerWords.ts";
import { cn } from "../../lib/utils.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import { STEPPED_ASIDE_STRIPES } from "./steppedAside.ts";

// How each state draws its bay, and its word under the bay. A running bay is full unless GitHub
// says which job it runs and the job log knows that job's usual time; then it fills toward it.
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

// A usual time, as rounded as a target needs to be: "40s", "6m".
const usualText = (ms: number) => (ms < 60_000 ? formatDuration(ms) : `${Math.round(ms / 60_000)}m`);

// Every runner as a tall bay: filled while it runs a job, striped while it stands aside for memory,
// outlined red while it fails to start. A runner GitHub names in `running` shows its job's
// repository and pull request or branch, and how long it has run of its usual time. Hovering says
// what it's doing and, when the machine gave one, why. `small` draws short narrow bays, for
// Overview, where they sit beside other sections, and leaves the usual time to the fill.
export function RunnerBays({ runners, running = [], now, small = false }: { runners: ReadonlyArray<RunnerTile>; running?: ReadonlyArray<RunningJob>; now: number; small?: boolean }) {
  return (
    <div className={cn("grid gap-x-2 gap-y-3", small ? "grid-cols-[repeat(auto-fill,minmax(4rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]")}>
      {runners.map((tile) => {
        const look = BAY[tile.state];
        const words = tile.state === "maybe_running" ? READY_OR_RUNNING : runnerPhase(tile.phase, tile.job);
        const job = tile.state === "running" && tile.runner ? running.find((each) => each.runner === tile.runner) : undefined;
        const ranMs = job ? Math.max(0, now - Date.parse(job.since)) : 0;
        const filled = job?.usualMs ? Math.min(1, ranMs / job.usualMs) : 1;
        return (
          <Tooltip key={`${tile.kind}-${tile.slot}`}>
            <TooltipTrigger
              render={
                <div className="flex min-w-0 flex-col gap-1.5">
                  {job ? (
                    <div className={cn("flex flex-col justify-end bg-foreground/[0.06]", small ? "h-11" : "h-20")}>
                      <div className="bg-foreground/85" style={{ height: `${filled * 100}%` }} />
                    </div>
                  ) : (
                    <div className={cn(small ? "h-11" : "h-20", look.bay)} style={tile.state === "stepped_aside" ? STEPPED_ASIDE_STRIPES : undefined} />
                  )}
                  <div className={cn("flex min-w-0 flex-col leading-snug", small ? "text-[11px]" : "text-xs")}>
                    <span className={cn("truncate font-medium", look.tone)}>{tile.state === "running" && tile.job ? tile.job : (job?.job ?? look.word)}</span>
                    {job ? (
                      <>
                        <span className="truncate text-muted-foreground">
                          {job.repo.split("/")[1]}
                          {job.ref ? ` ${job.ref}` : ""}
                        </span>
                        <span className="truncate tabular-nums">
                          {formatDuration(ranMs)}
                          {job.usualMs && !small ? <span className="text-muted-foreground"> of {usualText(job.usualMs)}</span> : null}
                        </span>
                      </>
                    ) : (
                      <span className="truncate text-muted-foreground">
                        {tile.kind} {tile.slot}
                        {TIMED.has(tile.state) ? <span className="tabular-nums">, {formatDuration(now - Date.parse(tile.since))}</span> : null}
                      </span>
                    )}
                  </div>
                </div>
              }
            />
            <TooltipPopup side="top">
              {words.text}
              {job ? ` on ${job.repo}${job.ref ? ` ${job.ref}` : ""}, ${tile.kind} ${tile.slot}` : ""}
              {tile.why ? `. ${tile.why}` : ""}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
