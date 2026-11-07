import { type } from "arktype";
import type { GitHubJob } from "../github/github-client.ts";

// One line of the job log. Bump `v` if the shape changes in a way old lines can't satisfy.
export const JobRecord = type({
  v: "1",
  repo: "string",
  workflow: "string | null",
  job: "string",
  jobId: "number",
  runId: "number",
  attempt: "number",
  branch: "string | null",
  conclusion: "string | null",
  // Null means no machine ever picked the job up, even if GitHub reports start and end times.
  runner: "string | null",
  labels: "string[]",
  createdAt: "string",
  startedAt: "string | null",
  completedAt: "string | null",
  steps: type({ name: "string", conclusion: "string | null", ms: "number | null" }).array(),
});

export type JobRecord = typeof JobRecord.infer;

export function elapsedMs(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  // Cancelled jobs can end "before" they start, and that time was never really spent.
  return ms < 0 ? null : ms;
}

// Removes records repeated by overlapping syncs. It also removes the copies "re-run failed jobs"
// makes of jobs that already passed: GitHub lists them under the new attempt with a new ID, but
// the original runner and times.
export function distinctJobs(records: readonly JobRecord[]) {
  const byIdentity = new Map<string, JobRecord>();
  for (const record of records) {
    const identity = record.runner
      ? [record.runId, record.workflow, record.job, record.runner, record.startedAt, record.completedAt].join("\0")
      : String(record.jobId);
    if (!byIdentity.has(identity)) byIdentity.set(identity, record);
  }
  return [...byIdentity.values()];
}

export function toJobRecord(repo: string, job: GitHubJob): JobRecord {
  return {
    v: 1,
    repo,
    workflow: job.workflow_name,
    job: job.name,
    jobId: job.id,
    runId: job.run_id,
    attempt: job.run_attempt,
    branch: job.head_branch,
    conclusion: job.conclusion,
    runner: job.runner_name || null,
    labels: job.labels,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    steps: (job.steps ?? []).map((step) => ({
      name: step.name,
      conclusion: step.conclusion,
      ms: elapsedMs(step.started_at, step.completed_at),
    })),
  };
}
