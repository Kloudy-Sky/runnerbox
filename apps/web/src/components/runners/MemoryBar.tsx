import type { MemoryPicture } from "@runnerbox/contracts";
import { formatMiB } from "../../lib/format.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";

// `mib` sets the width; `title` is what hovering says, with the amount as measured.
type Segment = { key: string; mib: number; fill: string; label: string; title: string };

const machinePart = (key: string, mib: number, fill: string, label: string): Segment => ({ key, mib, fill, label, title: `${label}, ${formatMiB(mib)}` });

// Running jobs alternate two shades, so neighbours stay apart without a legend per job.
const JOB_FILLS = ["bg-foreground/85", "bg-foreground/60"] as const;

// The machine's memory as one bar of plain boxes: each running job, everything else, what's free,
// and what Runnerbox keeps free (the floor). Each box says what it is on hover.
export function MemoryBar({ memory }: { memory: MemoryPicture }) {
  if (memory._tag === "none") return <p className="text-muted-foreground">{memory.why}</p>;
  const { totalMiB, availableMiB, floorMiB, jobs } = memory;
  const used = Math.max(0, totalMiB - availableMiB);
  // Container reads and the machine reading are taken apart, so jobs can add up to more than the
  // machine says is in use. Their shares are scaled to fit, so the bar never runs past full.
  const measured = jobs.reduce((sum, job) => sum + job.memMiB, 0);
  const scale = measured > used ? used / measured : 1;
  const jobsMiB = measured * scale;
  const kept = floorMiB === null ? 0 : Math.min(floorMiB, availableMiB);
  const segments: Segment[] = [
    ...jobs.map((job, index) => ({
      key: `${job.kind}-${job.slot}`,
      mib: job.memMiB * scale,
      fill: JOB_FILLS[index % JOB_FILLS.length]!,
      label: `${job.job ?? "a job"} on ${job.kind} ${job.slot}`,
      title: `${job.job ?? "a job"} on ${job.kind} ${job.slot}, ${formatMiB(job.memMiB)}`,
    })),
    machinePart("else", Math.max(0, used - jobsMiB), "bg-muted-foreground/45", jobs.length > 0 ? "everything else" : "in use"),
    machinePart("free", availableMiB - kept, "bg-success/35", "free"),
    machinePart("kept", kept, "bg-warning/45", "kept free"),
  ].filter((segment) => segment.mib > 0);
  // Kinds that keep a different amount free, as "(1.0 GB for light)".
  const others = memory.kindFloors.length === 0 ? "" : ` (${memory.kindFloors.map((each) => `${formatMiB(each.floorMiB)} for ${each.kind}`).join(", ")})`;
  const machine = memory.machine === "VM" ? "The VM's memory" : "The machine's memory";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{machine}</span>
        <span className="text-muted-foreground tabular-nums">{formatMiB(totalMiB)}</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden bg-muted">
        {segments.map((segment) => (
          <Tooltip key={segment.key}>
            <TooltipTrigger render={<span className={`h-full ${segment.fill}`} style={{ width: `${(segment.mib / totalMiB) * 100}%` }} />} />
            <TooltipPopup side="top">
              {segment.title}
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
        {segments.map((segment) => (
          <span key={segment.key} className="flex min-w-0 items-center gap-1">
            <span className={`inline-block size-2 shrink-0 ${segment.fill}`} />
            <span className="truncate">{segment.label}</span>
          </span>
        ))}
      </div>
      <p className="text-muted-foreground">
        {formatMiB(availableMiB)} is free.{" "}
        {floorMiB === null
          ? "The machine's records don't say how much Runnerbox keeps free."
          : `Runnerbox keeps ${formatMiB(floorMiB)} free before it starts another runner${others}, so the machine doesn't run out mid-job.`}
        {memory.unmeasured ? ` ${memory.unmeasured}` : ""}
      </p>
    </div>
  );
}
