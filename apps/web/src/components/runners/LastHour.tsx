import type { LaneState, RunnerLane, SlotPhase } from "@runnerbox/contracts";
import { Fragment } from "react";
import { formatDuration } from "../../lib/format.ts";
import { runnerPhase } from "../../lib/runnerWords.ts";
import { cn } from "../../lib/utils.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import { STEPPED_ASIDE_STRIPES } from "./steppedAside.ts";

const HOUR_MS = 3_600_000;
// A span ending this close to the moment the server wrote it is still going.
const STILL_GOING_MS = 5_000;
// A span's words are the bays', for the phase it was in.
const PHASE: Record<Exclude<LaneState, "failed_start">, SlotPhase> = { job: "busy", stepped_aside: "waiting", ready: "registered" };
const FAILED_START = "stopped before taking a job";
const QUARTERS = [0.25, 0.5, 0.75];

export type MachineLanes = { readonly key: string; readonly name: string; readonly lanes: ReadonlyArray<RunnerLane>; readonly now: number };

type Span = RunnerLane["spans"][number];

// How a span draws: finished jobs in grey with their name, a job still going in white, time stood
// aside in amber stripes, a ready runner as a hairline, and a failed start as a red mark.
function look(span: Span, now: number) {
  if (span.state === "failed_start") return { className: "inset-y-0 bg-destructive", label: null };
  if (span.state === "ready") return { className: "top-1/2 h-px bg-foreground/25", label: null };
  if (span.state === "stepped_aside") return { className: "inset-y-0", label: null };
  const going = Date.parse(span.end) >= now - STILL_GOING_MS;
  // A bar is narrow, so it carries the job's own name; hovering gives the workflow too.
  return { className: cn("inset-y-0 px-1", going ? "bg-foreground/85 text-background" : "bg-foreground/30 text-foreground"), label: span.job?.split(" / ").at(-1) ?? null };
}

// How much of the hour the runners spent on jobs, 0 to 1.
function busyShare(machines: ReadonlyArray<MachineLanes>) {
  const lanes = machines.flatMap((machine) => machine.lanes.map((lane) => ({ lane, from: machine.now - HOUR_MS, now: machine.now })));
  if (lanes.length === 0) return 0;
  const busy = lanes.map(({ lane, from, now }) =>
    lane.spans.filter((span) => span.state === "job").reduce((sum, span) => sum + Math.max(0, Math.min(now, Date.parse(span.end)) - Math.max(from, Date.parse(span.start))), 0),
  );
  return busy.reduce((sum, ms) => sum + Math.min(HOUR_MS, ms), 0) / (lanes.length * HOUR_MS);
}

// Each runner's last hour, runner by runner, grouped by machine. Every machine's hour is measured
// back from the moment its server wrote it. Machine names head their runners only when there are
// several, on a row of their own so the hour keeps its width in a narrow window.
export function LastHour({ machines }: { machines: ReadonlyArray<MachineLanes> }) {
  const several = machines.length > 1;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 bg-foreground/85" />
          running now
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 bg-foreground/30" />
          finished
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2" style={STEPPED_ASIDE_STRIPES} />
          stepped aside for memory
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-0.5 bg-destructive" />
          {FAILED_START}
        </span>
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
        {machines.map((machine, machineIndex) => (
          <Fragment key={machine.key}>
            {several ? <span className={cn("col-span-2 truncate font-medium", machineIndex > 0 && "pt-2")}>{machine.name}</span> : null}
            {machine.lanes.map((lane) => (
              <Fragment key={`${lane.kind}-${lane.slot}`}>
                <span className="truncate text-muted-foreground">
                  {lane.kind} {lane.slot}
                </span>
                <Track lane={lane} now={machine.now} />
              </Fragment>
            ))}
          </Fragment>
        ))}
        <span />
        <span className="flex justify-between whitespace-nowrap pt-1 font-mono text-[10px] text-muted-foreground">
          <span>an hour ago</span>
          <span className="hidden sm:inline">45 min</span>
          <span>30 min</span>
          <span className="hidden sm:inline">15 min</span>
          <span>now</span>
        </span>
      </div>
    </div>
  );
}

// Busy share of the hour, for the section's title.
export const lastHourNote = (machines: ReadonlyArray<MachineLanes>) => `busy ${Math.round(busyShare(machines) * 100)}% of the hour`;

function Track({ lane, now }: { lane: RunnerLane; now: number }) {
  const from = now - HOUR_MS;
  const fraction = (iso: string) => Math.min(1, Math.max(0, (Date.parse(iso) - from) / HOUR_MS));
  return (
    <span className="relative h-4">
      {QUARTERS.map((quarter) => (
        <span key={quarter} className="absolute inset-y-0 w-px bg-foreground/[0.07]" style={{ left: `${quarter * 100}%` }} />
      ))}
      {lane.spans.map((span) => {
        const { className, label } = look(span, now);
        const start = fraction(span.start);
        // A failed start lasts seconds, so it's a mark where it began, 2 px wide.
        const width = span.state === "failed_start" ? "2px" : `${Math.max(0.4, (fraction(span.end) - start) * 100)}%`;
        const title = span.state === "failed_start" ? FAILED_START : `${runnerPhase(PHASE[span.state], span.job).text}, ${formatDuration(Date.parse(span.end) - Date.parse(span.start))}`;
        return (
          <Tooltip key={`${span.start}-${span.state}`}>
            <TooltipTrigger
              render={
                <span
                  className={cn("absolute overflow-hidden whitespace-nowrap font-mono text-[10px] leading-4", className)}
                  style={{ left: `${start * 100}%`, width, ...(span.state === "stepped_aside" ? STEPPED_ASIDE_STRIPES : {}) }}
                >
                  {label}
                </span>
              }
            />
            <TooltipPopup side="top">{title}</TooltipPopup>
          </Tooltip>
        );
      })}
    </span>
  );
}
