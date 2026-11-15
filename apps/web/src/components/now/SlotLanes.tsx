import { busyShare, type Lane } from "../../lib/now.ts";

const FILL = { passed: "bg-success/45", failed: "bg-destructive/70", running: "bg-foreground/85", unknown: "bg-muted-foreground/40" } as const;

// The last hour of each slot as a strip: passed, failed and running jobs, and idle gaps.
export function SlotLanes({ lanes }: { lanes: ReadonlyArray<Lane> }) {
  if (lanes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {lanes.map((lane) => (
        <div key={`${lane.install}-${lane.kind}-${lane.slot}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2">
          <span className="truncate text-muted-foreground">
            {lane.kind} {lane.slot}
          </span>
          <span className="relative h-2.5 bg-muted">
            {lane.blocks.map((block) => (
              <span
                key={`${block.start}-${block.outcome}`}
                className={`absolute inset-y-0 ${FILL[block.outcome]}`}
                style={{ left: `${block.start * 100}%`, width: `${Math.max(0.5, (block.end - block.start) * 100)}%` }}
              />
            ))}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 text-muted-foreground text-xs">
        <span />
        <span className="flex justify-between">
          <span>an hour ago</span>
          <span>now</span>
        </span>
      </div>
      <p className="text-muted-foreground">
        Busy {Math.round(busyShare(lanes) * 100)}% of the hour. <span className="text-success">■</span> passed <span className="text-destructive">■</span> failed{" "}
        <span className="text-foreground">■</span> running <span className="text-muted-foreground/60">■</span> no job on record. Gaps are idle.
      </p>
    </div>
  );
}
