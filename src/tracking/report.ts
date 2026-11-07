import { elapsedMs, type JobRecord } from "./job-record.ts";

export type JobSummary = {
  workflow: string | null;
  job: string;
  runnerType: string;
  ran: number;
  failed: number;
  passedOnRetry: number;
  noRunner: number;
  p50Ms: number | null;
  p90Ms: number | null;
  queueP50Ms: number | null;
  totalMs: number;
};

// Nearest-rank percentile, so every value reported is a duration a job really had.
export function percentile(values: readonly number[], p: number) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? null;
}

// The labels a job asked for name the kind of runner, unlike the runner's own throwaway name.
export function runnerType({ labels }: Pick<JobRecord, "labels">) {
  return labels.filter((label) => label !== "self-hosted").join(",") || "unknown";
}

// A job that never got a machine still has start and end times, so runner is the only proof it ran.
const durationMs = (record: JobRecord) => elapsedMs(record.startedAt, record.completedAt);
const queueMs = (record: JobRecord) => elapsedMs(record.createdAt, record.startedAt);
const present = <T>(value: T | null): value is T => value !== null;
const isFailure = ({ conclusion }: JobRecord) => conclusion === "failure" || conclusion === "timed_out";

export function summarizeJobs(records: readonly JobRecord[]): JobSummary[] {
  // A job skipped by its `if:` was never meant to run, so it says nothing about runners.
  const considered = records.filter((record) => record.conclusion !== "skipped");
  const groups = Map.groupBy(considered, (record) => `${record.workflow}\0${record.job}\0${runnerType(record)}`);
  const retried = failuresThatPassedOnRetry(considered);

  return [...groups.values()]
    .map((group) => {
      const ran = group.filter((record) => record.runner !== null);
      const passed = ran.filter((record) => record.conclusion === "success");
      const durations = passed.map(durationMs).filter(present);
      const first = group[0]!;

      return {
        workflow: first.workflow,
        job: first.job,
        runnerType: runnerType(first),
        ran: ran.length,
        failed: ran.filter(isFailure).length,
        passedOnRetry: group.filter((record) => retried.has(record.jobId)).length,
        noRunner: group.length - ran.length,
        p50Ms: percentile(durations, 50),
        p90Ms: percentile(durations, 90),
        queueP50Ms: percentile(ran.map(queueMs).filter(present), 50),
        totalMs: ran.map(durationMs).filter(present).reduce((sum, ms) => sum + ms, 0),
      };
    })
    .toSorted((a, b) => b.totalMs - a.totalMs);
}

// Job IDs that failed on a machine and then passed on a later attempt of the same run.
function failuresThatPassedOnRetry(records: readonly JobRecord[]) {
  const sameJob = Map.groupBy(records, (record) => `${record.runId}\0${record.workflow}\0${record.job}`);
  const retried = new Set<number>();

  for (const attempts of sameJob.values()) {
    const lastPass = Math.max(
      0,
      ...attempts.filter((record) => record.conclusion === "success").map((record) => record.attempt),
    );
    for (const record of attempts) {
      if (record.runner !== null && isFailure(record) && record.attempt < lastPass) {
        retried.add(record.jobId);
      }
    }
  }
  return retried;
}

export type StepComparison = {
  runnerTypes: string[];
  steps: { name: string; p50MsByRunnerType: Map<string, number | null> }[];
};

// Median time per step for each runner type, from successful runs of one job. Shows where a job
// spends the extra time on a slower runner.
export function compareSteps(records: readonly JobRecord[], job: string): StepComparison {
  const passed = records.filter(
    (record) => record.job === job && record.runner !== null && record.conclusion === "success",
  );
  const byType = Map.groupBy(passed, runnerType);
  const stepNames = [...new Set(passed.flatMap((record) => record.steps.map((step) => step.name)))];

  return {
    runnerTypes: [...byType.keys()],
    steps: stepNames.map((name) => ({
      name,
      p50MsByRunnerType: new Map(
        [...byType].map(([type, group]) => [
          type,
          percentile(
            group
              .flatMap((record) => record.steps)
              .filter((step) => step.name === name && step.conclusion !== "skipped")
              .map((step) => step.ms)
              .filter(present),
            50,
          ),
        ]),
      ),
    })),
  };
}
