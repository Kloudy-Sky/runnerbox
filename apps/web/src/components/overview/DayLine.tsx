import { dayName, durationUnit, niceTicks } from "../../lib/chartScale.ts";
import { formatDuration } from "../../lib/format.ts";
import { CHART, columnX, valueY } from "./dayChart.ts";
import { DayAxes } from "./DayAxes.tsx";
import { DayChart } from "./DayChart.tsx";

type Props = { readonly days: ReadonlyArray<string>; readonly values: ReadonlyArray<number | null>; readonly usual: number | null; readonly label: string };

// A typical duration per day as a 2px line, broken where a day had nothing to time, with the usual
// level as a dashed reference. Each point has a hover title, and the newest is marked and labelled.
export function DayLine({ days, values, usual, label }: Props) {
  const unit = durationUnit(Math.max(...values.map((value) => value ?? 0), usual ?? 0));
  const ticks = niceTicks(Math.max(...values.map((value) => (value ?? 0) / unit.ms), (usual ?? 0) / unit.ms, 0));
  const top = ticks.at(-1) ?? 1;
  const y = (ms: number) => valueY(ms / unit.ms, top);
  return (
    <DayChart label={label}>
      {(width) => {
        const points = values.flatMap((value, index) => (value === null ? [] : [{ index, value, x: columnX(index, days.length, width), y: y(value) }]));
        const path = points.map((point, order) => `${points[order - 1]?.index === point.index - 1 ? "L" : "M"}${point.x},${point.y}`).join("");
        const last = points.at(-1);
        // Above the newest point and the one before it, so the line never runs through the label.
        const labelY = last ? Math.max(12, Math.min(last.y, points.at(-2)?.y ?? last.y) - 10) : 0;
        return (
          <>
            <DayAxes days={days} ticks={ticks} format={(value) => `${value}${unit.suffix}`} width={width} />
            {usual !== null ? <line x1={CHART.left} x2={width - CHART.right} y1={y(usual)} y2={y(usual)} className="stroke-muted-foreground" strokeDasharray="4 3" /> : null}
            <path d={path} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* A day with no timed neighbour has no line to sit on, so it gets a dot. */}
            {points
              .filter((point) => point !== last && values[point.index - 1] == null && values[point.index + 1] == null)
              .map((point) => (
                <circle key={point.index} cx={point.x} cy={point.y} r={3} className="fill-foreground" />
              ))}
            {last ? (
              <>
                <circle cx={last.x} cy={last.y} r={4} className="fill-foreground stroke-background" strokeWidth={2} />
                {last.index === days.length - 1 ? (
                  <text x={last.x + 6} y={labelY} textAnchor="end" className="fill-foreground font-semibold text-[11px]">
                    {formatDuration(last.value)} today
                  </text>
                ) : null}
              </>
            ) : null}
            {points.map((point) => (
              <circle key={point.index} cx={point.x} cy={point.y} r={11} fill="transparent">
                <title>{`${dayName(days[point.index] ?? "")}: ${formatDuration(point.value)}`}</title>
              </circle>
            ))}
          </>
        );
      }}
    </DayChart>
  );
}
