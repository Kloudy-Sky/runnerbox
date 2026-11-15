import type { JobRun } from "@runnerbox/contracts";
import { formatDuration, jobName } from "../../lib/format.ts";

// Jobs this machine finished in the last hour, newest first: whether each passed, and how long.
export function LastHour({ runs }: { runs: ReadonlyArray<JobRun> }) {
  if (runs.length === 0) return <p className="text-muted-foreground">No jobs finished here in the last hour.</p>;
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
      {runs.slice(0, 12).map((run) => (
        <div key={`${run.jobId}-${run.attempt}`} className="contents">
          <span className={run.conclusion === "success" ? "text-success" : run.conclusion === "failure" ? "text-destructive" : "text-muted-foreground"}>
            {run.conclusion === "success" ? "✓" : run.conclusion === "failure" ? "✗" : "·"}
          </span>
          <span className="truncate">
            {jobName(run)} <span className="text-muted-foreground">{run.branch ?? ""}</span>
          </span>
          <span className="text-muted-foreground tabular-nums">{formatDuration(run.durationMs)}</span>
        </div>
      ))}
      {runs.length > 12 ? <span className="col-span-3 text-muted-foreground">and {runs.length - 12} more</span> : null}
    </div>
  );
}
