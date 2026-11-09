import type { JobMachine } from "./job-machine.ts";
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
  queueP90Ms: number | null;
  totalMs: number;
  // From samples taken while the group's jobs ran. Null when none were.
  vmLowP50MiB: number | null;
  hostLowP50MiB: number | null;
  vmSwapP90MiB: number | null;
};

// `labels` groups by what jobs asked for. `runner` groups by the runner's name without its trailing
// numbers, which tells two launchers apart when they serve the same label.
export type GroupBy = "labels" | "runner";

// Nearest-rank percentile, so every value reported is a duration a job really had.
export function percentile(values: readonly number[], p: number) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? null;
}

// The labels a job asked for name the kind of runner, unlike the runner's own throwaway name.
export function runnerType({ labels }: Pick<JobRecord, "labels">) {
  return labels.filter((label) => label !== "self-hosted").join(",") || "unknown";
}

// runnerbox names runners `<install>-<kind>-<slot>-<epoch seconds>`, and a kind can be all digits,
// so exactly that suffix is removed. Other launchers' names lose every trailing number.
export function runnerGroup(record: JobRecord, by: GroupBy) {
  if (by === "labels") return runnerType(record);
  const { runner } = record;
  if (!runner) return "none";
  return /^(.+)-\d+-\d{10}$/.exec(runner)?.[1] ?? (runner.replace(/([-_ ]\d+)+$/, "") || runner);
}

// A job that never got a machine still has start and end times, so runner is the only proof it ran.
const durationMs = (record: JobRecord) => elapsedMs(record.startedAt, record.completedAt);
const queueMs = (record: JobRecord) => elapsedMs(record.createdAt, record.startedAt);
const present = <T>(value: T | null): value is T => value !== null;
const isFailure = ({ conclusion }: JobRecord) => conclusion === "failure" || conclusion === "timed_out";

type SummaryOptions = { by?: GroupBy; machine?: (record: JobRecord) => JobMachine | undefined };

export function summarizeJobs(records: readonly JobRecord[], { by = "labels", machine }: SummaryOptions = {}): JobSummary[] {
  // A job skipped by its `if:` was never meant to run, so it says nothing about runners.
  const considered = records.filter((record) => record.conclusion !== "skipped");
  const groups = Map.groupBy(considered, (record) => `${record.workflow}\0${record.job}\0${runnerGroup(record, by)}`);
  const retried = failuresThatPassedOnRetry(considered);

  return [...groups.values()]
    .map((group) => {
      const ran = group.filter((record) => record.runner !== null);
      const passed = ran.filter((record) => record.conclusion === "success");
      const durations = passed.map(durationMs).filter(present);
      const first = group[0]!;
      const machines = machine ? ran.map(machine).filter((found) => found !== undefined) : [];
      const fromMachines = (field: "vmLowMiB" | "hostLowMiB" | "vmSwapPeakMiB", p: number) =>
        percentile(machines.map((found) => found[field]).filter((value) => value !== undefined), p);

      return {
        workflow: first.workflow,
        job: first.job,
        runnerType: runnerGroup(first, by),
        ran: ran.length,
        failed: ran.filter(isFailure).length,
        passedOnRetry: group.filter((record) => retried.has(record.jobId)).length,
        noRunner: group.length - ran.length,
        p50Ms: percentile(durations, 50),
        p90Ms: percentile(durations, 90),
        queueP50Ms: percentile(ran.map(queueMs).filter(present), 50),
        queueP90Ms: percentile(ran.map(queueMs).filter(present), 90),
        totalMs: ran.map(durationMs).filter(present).reduce((sum, ms) => sum + ms, 0),
        vmLowP50MiB: fromMachines("vmLowMiB", 50),
        hostLowP50MiB: fromMachines("hostLowMiB", 50),
        vmSwapP90MiB: fromMachines("vmSwapPeakMiB", 90),
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
