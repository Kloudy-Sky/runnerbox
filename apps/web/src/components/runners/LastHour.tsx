import type { LaneState, RunnerLane, SlotPhase } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";
import { runnerPhase } from "../../lib/runnerWords.ts";
import { RunnerLanes } from "../RunnerLanes.tsx";

const HOUR_MS = 3_600_000;
// A span's words are the Now view's, for the phase it was in.
const PHASE: Record<Exclude<LaneState, "failed_start">, SlotPhase> = { job: "busy", stepped_aside: "waiting", ready: "registered" };
const FILL: Record<LaneState, string> = { job: "bg-foreground/85", stepped_aside: "bg-warning/60", ready: "bg-success/35", failed_start: "bg-destructive min-w-0.5" };
// A failed start lasts seconds, so it's drawn as a thin mark where it began.
const FAILED_START = "stopped before taking a job";

// Each runner's last hour, measured back from `now`, the moment the server wrote it.
export function LastHour({ lanes, now }: { lanes: ReadonlyArray<RunnerLane>; now: number }) {
  const from = now - HOUR_MS;
  const fraction = (iso: string) => Math.min(1, Math.max(0, (Date.parse(iso) - from) / HOUR_MS));
  const drawn = lanes.map((lane) => ({
    key: `${lane.kind}-${lane.slot}`,
    label: `${lane.kind} ${lane.slot}`,
    spans: lane.spans.map((span) => {
      if (span.state === "failed_start") return { start: fraction(span.start), end: fraction(span.start), fill: FILL.failed_start, title: FAILED_START };
      const what = runnerPhase(PHASE[span.state], span.job).text;
      return { start: fraction(span.start), end: fraction(span.end), fill: FILL[span.state], title: `${what}, ${formatDuration(Date.parse(span.end) - Date.parse(span.start))}` };
    }),
  }));
  return (
    <RunnerLanes lanes={drawn}>
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground/85">■</span> running a job <span className="text-warning">■</span> stepped aside for memory <span className="text-success/60">■</span> ready <span className="text-destructive">|</span> {FAILED_START}. Gaps are
        time the records can't place.
      </p>
    </RunnerLanes>
  );
}
