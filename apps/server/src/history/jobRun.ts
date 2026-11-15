import type { JobRun, Verdict } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType, starved } from "runnerbox/src/tracking/report.ts";

// One job record as the run list and the job page show it, with its failure verdict if it has one.
export function toJobRun(record: JobRecord, verdict: Verdict | null): JobRun {
  const { v: _v, labels, steps: _steps, ...job } = record;
  return {
    ...job,
    runnerType: runnerType({ labels }),
    headSha: job.headSha ?? null,
    durationMs: elapsedMs(job.startedAt, job.completedAt),
    queueMs: job.runner === null ? null : elapsedMs(job.createdAt, job.startedAt),
    verdict,
    starved: starved(record),
  };
}
