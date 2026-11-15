import type { RunnerTile } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";
import { READY_OR_RUNNING, runnerPhase } from "../../lib/runnerWords.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";

// How long a state has lasted is worth saying only for work and for waiting on memory.
const TIMED = new Set<RunnerTile["state"]>(["running", "stepped_aside"]);

// Every runner as a tile: its kind and number, and what it's doing in the Now view's words. A tile
// whose runner is waiting says why on hover, when the machine gave a reason.
export function RunnerTiles({ runners, now }: { runners: ReadonlyArray<RunnerTile>; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-2">
        {runners.map((tile) => {
          const words = tile.state === "maybe_running" ? READY_OR_RUNNING : runnerPhase(tile.phase, tile.job);
          const body = (
            <div className="flex min-w-0 flex-col">
              <span className="text-muted-foreground">
                {tile.kind} {tile.slot}
              </span>
              <span className={`break-words ${words.tone}`}>
                {words.text}
                {TIMED.has(tile.state) ? <span className="text-muted-foreground">, {formatDuration(now - Date.parse(tile.since))}</span> : null}
              </span>
            </div>
          );
          return tile.why ? (
            <Tooltip key={`${tile.kind}-${tile.slot}`}>
              <TooltipTrigger render={body} />
              <TooltipPopup side="top">{tile.why}</TooltipPopup>
            </Tooltip>
          ) : (
            <div key={`${tile.kind}-${tile.slot}`}>{body}</div>
          );
        })}
      </div>
      <p className="text-muted-foreground">A runner takes one job at a time. A job asks for a kind of runner by name in its workflow file.</p>
    </div>
  );
}
