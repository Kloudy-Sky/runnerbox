import type { JobTrend } from "@runnerbox/contracts";
import { formatDuration, jobName } from "../../lib/format.ts";
import { cn } from "../../lib/utils.ts";

export const trendKey = (trend: JobTrend) => `${trend.workflow}\0${trend.job}\0${trend.runnerType}`;

const th = "py-1.5 pr-4 font-normal text-muted-foreground";

// Jobs ranked by the time they spent on runners, as bars, with their typical time and what it was
// before when a job has become slower. Picking one opens its panel.
export function TimeByJob({ trends, picked, onPick }: { readonly trends: readonly JobTrend[]; readonly picked: string | null; readonly onPick: (key: string) => void }) {
  if (trends.length === 0) return <p className="text-muted-foreground">No jobs ran in this repository in this time.</p>;
  const most = Math.max(...trends.map((trend) => trend.runnerMs), 1);
  return (
    <table className="w-full max-w-4xl border-collapse">
      <thead className="text-left">
        <tr>
          <th className={th}>Job</th>
          <th className={th}>Runs on</th>
          <th className={`${th} w-1/3`}>Runner time</th>
          <th className={`${th} text-right`}>Typical</th>
          <th className={`${th} text-right`}>Ran</th>
        </tr>
      </thead>
      <tbody>
        {trends.map((trend) => (
          <tr key={trendKey(trend)} onClick={() => onPick(trendKey(trend))} className={cn("cursor-default", picked === trendKey(trend) ? "bg-accent" : "hover:bg-surface")}>
            <td className="py-1 pr-4 whitespace-nowrap">{jobName(trend)}</td>
            <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{trend.runnerType}</td>
            <td className="py-1 pr-4">
              <div className="flex items-center gap-2">
                <div className="h-2 rounded-xs bg-info" style={{ width: `${(trend.runnerMs / most) * 100}%`, minWidth: 2 }} />
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(trend.runnerMs)}</span>
              </div>
            </td>
            <td className="py-1 pr-4 text-right whitespace-nowrap tabular-nums">
              {formatDuration(trend.typicalMs)}
              {trend.slower ? <span className="text-warning">, was {formatDuration(trend.earlierTypicalMs)}</span> : null}
            </td>
            <td className="py-1 pr-4 text-right tabular-nums text-muted-foreground">{trend.runs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
