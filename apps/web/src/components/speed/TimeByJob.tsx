import type { JobTrend } from "@runnerbox/contracts";
import { jobName } from "../../lib/format.ts";
import { cn } from "../../lib/utils.ts";
import { hours } from "./words.ts";

export const trendKey = (trend: JobTrend) => `${trend.workflow}\0${trend.job}\0${trend.runnerType}`;

const ROW = "grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 @lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4rem_4rem]";

// How a job's typical time moved against the same stretch before the window, "+18%".
function change(trend: JobTrend) {
  if (trend.typicalMs === null || !trend.earlierTypicalMs) return null;
  const share = Math.round(((trend.typicalMs - trend.earlierTypicalMs) / trend.earlierTypicalMs) * 100);
  return `${share > 0 ? "+" : ""}${share}%`;
}

// Jobs ranked by the time they spent on runners, as bars, with how their typical time moved from
// the period before. Picking one opens its steps. A job on GitHub's machines says so, since the
// same job can have a row on each. In a narrow column the bars go and the hours stay.
export function TimeByJob({ trends, picked, onPick }: { readonly trends: readonly JobTrend[]; readonly picked: string | null; readonly onPick: (key: string) => void }) {
  if (trends.length === 0) return <p className="text-muted-foreground">No jobs ran in this repository in this time.</p>;
  const most = Math.max(...trends.map((trend) => trend.runnerMs), 1);
  return (
    <div className="@container flex flex-col">
      <div className={cn(ROW, "pb-1.5 text-xs text-muted-foreground")}>
        <span>Job</span>
        <span className="hidden @lg:block">Time on runners</span>
        <span />
        <span className="text-right" title="Typical time against the same stretch before">vs before</span>
      </div>
      {trends.map((trend) => {
        const key = trendKey(trend);
        const moved = change(trend);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            aria-pressed={picked === key}
            className={cn(ROW, "-mx-2 rounded-sm px-2 py-1 text-left", picked === key ? "bg-accent" : "hover:bg-surface")}
          >
            <span className="min-w-0 truncate">
              <span className="font-medium">{jobName(trend)}</span>
              <span className="text-muted-foreground">
                {" "}
                {trend.runnerType}
                {trend.hosted ? ", GitHub's" : ""}
              </span>
            </span>
            <span className="hidden h-1.5 @lg:block">
              <span className="block h-full rounded-r-xs bg-foreground/85" style={{ width: `${(trend.runnerMs / most) * 100}%`, minWidth: 2 }} />
            </span>
            <span className="text-right tabular-nums">{hours(trend.runnerMs)}</span>
            <span className={cn("text-right tabular-nums", trend.slower ? "text-foreground" : "text-muted-foreground")}>{moved ?? "-"}</span>
          </button>
        );
      })}
    </div>
  );
}
