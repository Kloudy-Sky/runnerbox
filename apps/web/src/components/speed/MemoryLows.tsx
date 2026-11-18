import type { HealthDay } from "@runnerbox/contracts";
import { formatMiB } from "../../lib/format.ts";
import { memoryTone } from "./healthWords.ts";
import { shortDay } from "./shortDay.ts";

const BAR = 3;
const GAP = 2;
const HEIGHT = 24;
const TONE_FILL = { bad: "fill-destructive", warn: "fill-warning", muted: "fill-muted-foreground" } as const;

// Each day's lowest free VM memory as a thin bar, against the dashed line runners pause below:
// amber under it, red when it nearly ran out. Days with no VM reading draw nothing.
export function MemoryLows({ days, length, pauseBelowMiB }: { readonly days: readonly HealthDay[]; readonly length: number; readonly pauseBelowMiB: number | null }) {
  const shown = days.slice(-length);
  const offset = length - shown.length;
  const lows = shown.flatMap((day) => (day.lowestVmFreeMiB === null ? [] : [day.lowestVmFreeMiB]));
  if (lows.length === 0) return <span className="text-xs text-muted-foreground">No VM readings</span>;
  // The pause line sits two thirds of the way down at most, so a bar under it is plain to see.
  const top = Math.max(...lows, (pauseBelowMiB ?? 0) * 1.5, 1);
  const y = (mib: number) => HEIGHT - (mib / top) * HEIGHT;
  const width = length * (BAR + GAP) - GAP;
  return (
    <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} className="block max-w-full overflow-visible" role="img" aria-label="Lowest free memory each day">
      {shown.map((day, index) => {
        if (day.lowestVmFreeMiB === null) return null;
        const tone = memoryTone(day.lowestVmFreeMiB, pauseBelowMiB) ?? "muted";
        const barTop = Math.min(y(day.lowestVmFreeMiB), HEIGHT - 1);
        return (
          <rect key={day.day} x={(offset + index) * (BAR + GAP)} y={barTop} width={BAR} height={HEIGHT - barTop} rx={1} className={`${TONE_FILL[tone]} hover:opacity-70`}>
            <title>{`${shortDay(day.day)}: ${formatMiB(day.lowestVmFreeMiB)} free at the lowest`}</title>
          </rect>
        );
      })}
      {pauseBelowMiB !== null ? <line x1={0} x2={width} y1={y(pauseBelowMiB)} y2={y(pauseBelowMiB)} className="stroke-warning" strokeWidth={1} strokeDasharray="3 2" /> : null}
    </svg>
  );
}
