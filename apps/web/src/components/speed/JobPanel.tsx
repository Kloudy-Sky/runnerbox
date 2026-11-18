import type { JobRun, JobTrend } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { formatDuration, jobName } from "../../lib/format.ts";
import type { RootSearch } from "../../lib/search.ts";
import { StepBar } from "./StepBar.tsx";

// Runs within this share of the typical time count as typical.
const TYPICAL_SHARE = 0.25;

// A typical run of the job: the newest passing run within a quarter of its typical time, or else
// the closest, so the link opens what the job usually does now rather than its slowest or its failures.
function typicalRun(runs: readonly JobRun[], trend: JobTrend) {
  const own = runs.filter(
    (run): run is JobRun & { durationMs: number } => run.workflow === trend.workflow && run.job === trend.job && run.runnerType === trend.runnerType && run.conclusion === "success" && run.durationMs !== null,
  );
  const typical = trend.typicalMs ?? 0;
  const near = own.filter((run) => Math.abs(run.durationMs - typical) <= typical * TYPICAL_SHARE).toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (near[0]) return near[0];
  return own.reduce<(typeof own)[number] | undefined>((best, run) => (best === undefined || Math.abs(run.durationMs - typical) < Math.abs(best.durationMs - typical) ? run : best), undefined);
}

// The picked job beside the list: its typical passing run step by step as one bar, what changed if
// it became slower, and a link to a typical run for its memory and CPU.
export function JobPanel({ trend, runs, repo, days }: { readonly trend: JobTrend; readonly runs: readonly JobRun[] | undefined; readonly repo: string; readonly days: number }) {
  const workflow = trend.workflow;
  const job = trend.job;
  const comparison = useRpcQuery(["stepComparison", repo, days, workflow, job], (client) =>
    client["history.stepComparison"]({ repo, days, by: "labels", job, ...(workflow ? { workflow } : {}) }),
  );
  // Only this runner's own steps: another runner's would show under this one's name.
  const column = comparison.data?.runnerTypes.includes(trend.runnerType) ? trend.runnerType : undefined;
  const steps = (comparison.data?.steps ?? []).flatMap((step) => {
    const ms = column ? (step.p50MsByRunnerType[column] ?? null) : null;
    return ms ? [{ name: step.name, ms }] : [];
  });
  const run = runs ? typicalRun(runs, trend) : undefined;
  const change = trend.change ?? null;
  return (
    <aside className="flex min-w-0 flex-col gap-3">
      <span className="text-muted-foreground">
        A typical {jobName(trend)} run on {trend.runnerType}, {formatDuration(trend.typicalMs)}
        {trend.slower ? `, was ${formatDuration(trend.earlierTypicalMs)}` : ""}
      </span>
      {steps.length > 0 ? <StepBar steps={steps} marked={change?.step ?? null} /> : comparison.data ? <p className="text-muted-foreground">No passing run with steps in this time.</p> : null}
      {change ? <p className="text-foreground/90">{change.text}</p> : null}
      {run ? (
        <Link to="/runs/$jobId" params={{ jobId: String(run.jobId) }} search={(previous: RootSearch) => ({ ...previous, repo })} className="self-start underline underline-offset-2">
          Open a typical run, #{run.runId}
        </Link>
      ) : null}
    </aside>
  );
}
