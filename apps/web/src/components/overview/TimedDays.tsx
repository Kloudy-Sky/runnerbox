import { formatDuration } from "../../lib/format.ts";
import { ChartLegend } from "./ChartLegend.tsx";
import { DayLine } from "./DayLine.tsx";

// A typical time per day with its legend, or a line saying nothing was timed in the range.
export function TimedDays({ days, values, usual, name, label, empty }: { days: ReadonlyArray<string>; values: ReadonlyArray<number | null>; usual: number | null; name: string; label: string; empty: string }) {
  if (values.every((value) => value === null)) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <>
      <ChartLegend keys={[{ label: name, mark: "line", className: "bg-foreground" }, ...(usual !== null ? [{ label: `Usual, ${formatDuration(usual)}`, mark: "dash" as const, className: "border-muted-foreground" }] : [])]} />
      <DayLine days={days} values={values} usual={usual} label={label} />
    </>
  );
}
