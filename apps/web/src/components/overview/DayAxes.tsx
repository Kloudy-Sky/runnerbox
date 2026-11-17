import { dayTicks } from "../../lib/chartScale.ts";
import { CHART, columnX, valueY } from "./dayChart.ts";

// A day chart's quiet frame: a hairline at each value tick with its label, and the dates under
// the columns.
export function DayAxes({ days, ticks, format, width }: { days: ReadonlyArray<string>; ticks: ReadonlyArray<number>; format: (value: number) => string; width: number }) {
  const top = ticks.at(-1) ?? 1;
  return (
    <g className="fill-muted-foreground font-mono text-[10px]">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={CHART.left} x2={width - CHART.right} y1={valueY(tick, top)} y2={valueY(tick, top)} className="stroke-border" vectorEffect="non-scaling-stroke" />
          <text x={CHART.left - 6} y={valueY(tick, top) + 3.5} textAnchor="end">
            {format(tick)}
          </text>
        </g>
      ))}
      {dayTicks(days).map((tick, index) =>
        tick ? (
          <text key={days[index]} x={columnX(index, days.length, width)} y={CHART.base + 16} textAnchor="middle">
            {tick.day}
            {tick.month ? (
              <tspan x={columnX(index, days.length, width)} dy={12}>
                {tick.month}
              </tspan>
            ) : null}
          </text>
        ) : null,
      )}
    </g>
  );
}
