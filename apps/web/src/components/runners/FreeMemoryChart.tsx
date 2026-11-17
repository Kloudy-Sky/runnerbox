import type { FreeMemory } from "../../lib/freeMemory.ts";
import { formatMiB } from "../../lib/format.ts";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const GIB = 1024;
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Gridlines a whole number of GB apart, about four of them up to the machine's total.
function gridMiB(totalMiB: number) {
  const step = [1, 2, 4, 8, 16, 32, 64].find((each) => each * 4 * GIB >= totalMiB) ?? 128;
  return Array.from({ length: Math.floor(totalMiB / (step * GIB)) + 1 }, (_, index) => index * step * GIB);
}

// Free memory over the last hour as one thin line, with the dashed line where Runnerbox pauses
// runners. The drawing stretches to its box; labels sit outside it so they never stretch. Each
// minute says its reading on hover.
export function FreeMemoryChart({ memory, now }: { memory: FreeMemory; now: number }) {
  const { points, totalMiB, floorMiB } = memory;
  const from = now - HOUR_MS;
  const x = (at: number) => (at - from) / MINUTE_MS;
  const y = (mib: number) => totalMiB - mib;
  const grid = gridMiB(totalMiB);
  const line = points.map((point) => `${x(point.at)},${y(point.availableMiB)}`).join(" ");
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap gap-x-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-3 bg-foreground" />
          Free memory
        </span>
        {floorMiB !== null ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 border-warning border-t border-dashed" />
            Runners pause below {formatMiB(floorMiB)}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2">
        <div className="relative h-28 font-mono text-[10px] text-muted-foreground">
          {grid.map((mib) => (
            <span key={mib} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: `${(y(mib) / totalMiB) * 100}%` }}>
              {mib / GIB} GB
            </span>
          ))}
        </div>
        <svg className="h-28 w-full overflow-visible" viewBox={`0 0 60 ${totalMiB}`} preserveAspectRatio="none" role="img" aria-label="Free memory over the last hour">
          {grid.map((mib) => (
            <line key={mib} x1={0} x2={60} y1={y(mib)} y2={y(mib)} className="stroke-foreground/10" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {floorMiB !== null ? (
            <line x1={0} x2={60} y1={y(floorMiB)} y2={y(floorMiB)} className="stroke-warning" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ) : null}
          <polyline points={line} fill="none" className="stroke-foreground" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {points.map((point) => (
            <rect key={point.at} x={x(point.at) - 0.5} width={1} y={0} height={totalMiB} fill="transparent">
              <title>{`${clock(point.at)}, ${formatMiB(point.availableMiB)} free`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 font-mono text-[10px] text-muted-foreground">
        <span />
        <span className="flex justify-between">
          <span>an hour ago</span>
          <span>30 min</span>
          <span>now</span>
        </span>
      </div>
    </div>
  );
}
