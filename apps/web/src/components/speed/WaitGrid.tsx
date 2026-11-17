import { formatDuration } from "../../lib/format.ts";
import { WEEKDAYS, type WaitCell } from "./waitsByHour.ts";

// One gray, darker to lighter as the typical wait grows, with its own step for hours with no jobs.
const NO_JOBS = "#1d1d1d";
const STEPS = [
  { below: 5_000, color: "#333331" },
  { below: 10_000, color: "#5c5c59" },
  { below: 20_000, color: "#8a8a86" },
  { below: 30_000, color: "#bdbdb9" },
  { below: Number.POSITIVE_INFINITY, color: "#f2f2ef" },
] as const;
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

const shade = ({ jobs, typicalMs }: WaitCell) => (jobs === 0 || typicalMs === null ? NO_JOBS : (STEPS.find((step) => typicalMs < step.below)?.color ?? NO_JOBS));
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

// A week of hours, Monday to Sunday down the side, shaded by how long jobs queued then typically
// waited for a runner. Each cell names its hour, wait and jobs on hover.
export function WaitGrid({ grid }: { readonly grid: readonly (readonly WaitCell[])[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-0.5" role="img" aria-label="Typical wait for a runner, by weekday and hour">
        {grid.map((hours, weekday) => (
          <div key={WEEKDAYS[weekday]} className="contents">
            <span className="font-mono text-[10px] leading-none self-center text-muted-foreground">{WEEKDAYS[weekday]!.slice(0, 3)}</span>
            {hours.map((cell, hour) => (
              <span
                key={hour}
                className="aspect-square rounded-[2px] hover:outline hover:outline-1 hover:outline-foreground"
                style={{ background: shade(cell) }}
                title={`${WEEKDAYS[weekday]} ${hourLabel(hour)}: ${cell.jobs === 0 ? "no jobs" : `typically ${formatDuration(cell.typicalMs)} over ${cell.jobs} job${cell.jobs === 1 ? "" : "s"}`}`}
              />
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="font-mono text-[10px] leading-none text-muted-foreground">
            {HOUR_TICKS.includes(hour) ? hourLabel(hour) : null}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="pr-1">No jobs</span>
        {[NO_JOBS, ...STEPS.map((step) => step.color)].map((color) => (
          <i key={color} className="h-2 w-4 rounded-[2px]" style={{ background: color }} />
        ))}
        <span className="pl-1">30s or more</span>
      </div>
    </div>
  );
}
