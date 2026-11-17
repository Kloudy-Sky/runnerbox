import { dayName, niceTicks } from "../../lib/chartScale.ts";
import { CHART, columnWidth, columnX, valueY } from "./dayChart.ts";
import { DayAxes } from "./DayAxes.tsx";
import { DayChart } from "./DayChart.tsx";

type Series = { readonly label: string; readonly fill: string; readonly values: ReadonlyArray<number> };

const GAP = 2;
const RADIUS = 4;

// A bar with a rounded top and a square foot, or square throughout when another part sits on it.
function barPath(x: number, y: number, width: number, height: number, rounded: boolean) {
  const r = rounded ? Math.min(RADIUS, height, width / 2) : 0;
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

// One day's parts stacked from the baseline, each below the next by a 2px gap, the top one rounded.
function stack(values: ReadonlyArray<{ readonly label: string; readonly fill: string; readonly value: number }>, top: number) {
  const parts = values.filter((part) => part.value > 0);
  let foot: number = CHART.base;
  return parts.map((part, order) => {
    const gap = order > 0 ? GAP : 0;
    const height = Math.max(1, CHART.base - valueY(part.value, top) - gap);
    const y = foot - gap - height;
    foot = y;
    return { ...part, y, height, rounded: order === parts.length - 1 };
  });
}

// Stacked columns, one per day, the first series at the bottom. Each column's hover title gives
// every part's count.
export function DayBars({ days, series, label }: { days: ReadonlyArray<string>; series: ReadonlyArray<Series>; label: string }) {
  const totals = days.map((_, index) => series.reduce((sum, each) => sum + (each.values[index] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks.at(-1) ?? 1;
  return (
    <DayChart label={label}>
      {(width) => {
        const slot = columnWidth(days.length, width);
        const bar = Math.min(24, slot * 0.62);
        return (
          <>
            <DayAxes days={days} ticks={ticks} format={(value) => value.toLocaleString()} width={width} />
            {days.map((day, index) => {
              const x = columnX(index, days.length, width);
              return (
                <g key={day}>
                  {stack(series.map((each) => ({ label: each.label, fill: each.fill, value: each.values[index] ?? 0 })), top).map((part) => (
                    <path key={part.label} d={barPath(x - bar / 2, part.y, bar, part.height, part.rounded)} className={part.fill} />
                  ))}
                  <rect x={x - slot / 2} y={CHART.top} width={slot} height={CHART.base - CHART.top} fill="transparent">
                    <title>{`${dayName(day)}: ${series.map((each) => `${(each.values[index] ?? 0).toLocaleString()} ${each.label.toLowerCase()}`).join(", ")}`}</title>
                  </rect>
                </g>
              );
            })}
          </>
        );
      }}
    </DayChart>
  );
}
