import { formatDuration } from "../../lib/format.ts";
import { busyShare, type Lane } from "../../lib/now.ts";
import { RunnerLanes } from "../RunnerLanes.tsx";

const FILL = { passed: "bg-success/45", failed: "bg-destructive/70", running: "bg-foreground/85", unknown: "bg-muted-foreground/40" } as const;
const WORDS = { passed: "a job that passed", failed: "a job that failed", running: "running a job", unknown: "a job with no result on record" } as const;
const HOUR_MS = 3_600_000;

// The last hour of each slot as a strip: passed, failed and running jobs, and idle gaps.
export function SlotLanes({ lanes }: { lanes: ReadonlyArray<Lane> }) {
  const drawn = lanes.map((lane) => ({
    key: `${lane.install}-${lane.kind}-${lane.slot}`,
    label: `${lane.kind} ${lane.slot}`,
    spans: lane.blocks.map((block) => ({ start: block.start, end: block.end, fill: FILL[block.outcome], title: `${WORDS[block.outcome]}, ${formatDuration((block.end - block.start) * HOUR_MS)}` })),
  }));
  return (
    <RunnerLanes lanes={drawn}>
      <p className="text-muted-foreground">
        Busy {Math.round(busyShare(lanes) * 100)}% of the hour. <span className="text-success">■</span> passed <span className="text-destructive">■</span> failed{" "}
        <span className="text-foreground">■</span> running <span className="text-muted-foreground/60">■</span> no job on record. Gaps are idle.
      </p>
    </RunnerLanes>
  );
}
