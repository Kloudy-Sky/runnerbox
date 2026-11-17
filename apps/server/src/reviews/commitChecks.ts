import type { Check, CheckState } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { NAME_CHARS, oneLine } from "./pullRequests.ts";

// A commit's checks are its jobs, from this machine's job history and from GitHub's Actions API,
// joined so each job shows once, at its newest attempt.

// One job from either source, with the run and attempt that decide which is newest.
export type CommitJob = {
  readonly runId: number;
  readonly attempt: number;
  readonly workflow: string | null;
  readonly name: string;
  readonly state: CheckState;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

// GitHub's replies are outside input: only these fields are read.
const Runs = Schema.Struct({ workflow_runs: Schema.Array(Schema.Struct({ id: Schema.Int, run_attempt: Schema.optionalKey(Schema.Int), status: Schema.NullOr(Schema.String) })) });
const Jobs = Schema.Struct({
  jobs: Schema.Array(
    Schema.Struct({
      run_id: Schema.Int,
      run_attempt: Schema.optionalKey(Schema.Int),
      workflow_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      started_at: Schema.NullOr(Schema.String),
      completed_at: Schema.NullOr(Schema.String),
    }),
  ),
});

function stateOf(status: string, conclusion: string | null): CheckState {
  if (status === "in_progress") return "running";
  if (status !== "completed") return "waiting";
  if (conclusion === "success" || conclusion === "neutral") return "passed";
  if (conclusion === "skipped" || conclusion === "cancelled") return conclusion;
  return "failed";
}

// A job history recorded. History holds a run's jobs only once every one of them has ended.
export const jobOfRecord = (record: JobRecord): CommitJob => ({
  runId: record.runId,
  attempt: record.attempt,
  workflow: record.workflow,
  name: record.job,
  state: stateOf("completed", record.conclusion),
  startedAt: record.startedAt,
  completedAt: record.completedAt,
});

// The runs on a commit, or null when the reply isn't a list of them.
export function runsOf(body: unknown) {
  return Option.match(Schema.decodeUnknownOption(Runs)(body), {
    onNone: () => null,
    onSome: ({ workflow_runs }) => workflow_runs.map((run) => ({ id: run.id, attempt: run.run_attempt ?? 1, ended: run.status === "completed" })),
  });
}

// A run's jobs, or null when the reply isn't a list of them.
export function jobsOf(body: unknown): ReadonlyArray<CommitJob> | null {
  return Option.match(Schema.decodeUnknownOption(Jobs)(body), {
    onNone: () => null,
    onSome: ({ jobs }) =>
      jobs.map((job) => ({
        runId: job.run_id,
        attempt: job.run_attempt ?? 1,
        workflow: job.workflow_name ?? null,
        name: job.name,
        state: stateOf(job.status, job.conclusion),
        startedAt: job.started_at,
        completedAt: job.completed_at,
      })),
  });
}

// Each job once, by workflow and name, at its newest run and attempt; a tie goes to the later in
// `jobs`, so GitHub's go after history's. Names are whatever a workflow file says, so they're
// cleaned like a title.
export function checksOf(jobs: ReadonlyArray<CommitJob>): ReadonlyArray<Check> {
  const newest = new Map<string, CommitJob>();
  for (const job of jobs) {
    const key = `${job.workflow ?? ""}\0${job.name}`;
    const kept = newest.get(key);
    if (kept === undefined || job.runId > kept.runId || (job.runId === kept.runId && job.attempt >= kept.attempt)) newest.set(key, job);
  }
  return [...newest.values()]
    .map((job) => {
      const startedAt = job.state === "waiting" ? null : job.startedAt;
      return { name: oneLine(job.name, NAME_CHARS), workflow: job.workflow === null ? null : oneLine(job.workflow, NAME_CHARS), state: job.state, startedAt, durationMs: elapsedMs(startedAt, job.completedAt) };
    })
    .toSorted((a, b) => (a.workflow ?? "").localeCompare(b.workflow ?? "") || a.name.localeCompare(b.name));
}
