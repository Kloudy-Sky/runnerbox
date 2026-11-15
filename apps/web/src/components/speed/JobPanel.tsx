import type { JobRun, JobTrend } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { useJobResources } from "../../hooks/useJobResources.ts";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { formatDuration, jobName } from "../../lib/format.ts";
import type { RootSearch } from "../../lib/search.ts";
import { JobResourcesView } from "../job/JobResourcesView.tsx";

// Runs within this share of the typical time count as typical.
const TYPICAL_SHARE = 0.25;

// A typical run of the job: the newest passing run within a quarter of its typical time, or else
// the closest, so the graphs show what the job usually does now rather than its slowest or its failures.
function typicalRun(runs: readonly JobRun[], trend: JobTrend) {
  const own = runs.filter(
    (run): run is JobRun & { durationMs: number } => run.workflow === trend.workflow && run.job === trend.job && run.runnerType === trend.runnerType && run.conclusion === "success" && run.durationMs !== null,
  );
  const typical = trend.typicalMs ?? 0;
  const near = own.filter((run) => Math.abs(run.durationMs - typical) <= typical * TYPICAL_SHARE).toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (near[0]) return near[0];
  return own.reduce<(typeof own)[number] | undefined>((best, run) => (best === undefined || Math.abs(run.durationMs - typical) < Math.abs(best.durationMs - typical) ? run : best), undefined);
}

// The picked job beside the list: what changed if it became slower, then a typical run's steps,
// memory and CPU, drawn by the run page's own view.
export function JobPanel({ trend, repo, days }: { readonly trend: JobTrend; readonly repo: string; readonly days: number }) {
  // The same call, and so the same cache, as the run list.
  const runs = useRpcQuery(["runs", repo, days], (client) => client["history.runs"]({ repo, days, limit: 2000 }));
  const run = runs.data ? typicalRun(runs.data, trend) : undefined;
  const resources = useJobResources(run);
  const change = trend.change ?? null;
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{jobName(trend)}</h3>
        <span className="text-muted-foreground">
          {trend.slower ? `slower: typically ${formatDuration(trend.typicalMs)}, was ${formatDuration(trend.earlierTypicalMs)}` : `typically ${formatDuration(trend.typicalMs)}`}
          {run ? (
            <>
              {" · "}
              <Link to="/runs/$jobId" params={{ jobId: String(run.jobId) }} search={(previous: RootSearch) => ({ ...previous, repo })} className="underline-offset-2 hover:underline">
                a typical run, #{run.runId}
              </Link>
            </>
          ) : null}
        </span>
      </div>
      {change ? <p className="text-foreground/90">{change.text}</p> : null}
      {resources.data ? <JobResourcesView resources={resources.data} markedStep={change?.step ?? null} /> : runs.data && !run ? <p className="text-muted-foreground">No passing run of this job in this time to show.</p> : null}
    </aside>
  );
}
