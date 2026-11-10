import type { GroupBy, JobRun, JobSummary, Overview, StepComparison, WeeklySummary } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { elapsedMs } from "runnerbox/src/tracking/job-record.ts";
import { summarizeLauncher } from "runnerbox/src/tracking/launcher-summary.ts";
import { summarizeMachines } from "runnerbox/src/tracking/machine-summary.ts";
import { compareSteps, percentile, runnerType, summarizeJobs } from "runnerbox/src/tracking/report.ts";
import { verdictsByJobId } from "../inbox/rules.ts";
import { machineLookup } from "./machineLookup.ts";
import * as StateLogs from "./StateLogs.ts";

const DAY_MS = 24 * 60 * 60_000;

type Window = { readonly repo: string; readonly days: number };
type Filter = Window & { readonly by: GroupBy; readonly workflow?: string };

// Job history as `report` and `summary` compute it, from the local logs alone. It never calls
// GitHub, so it works on any machine with a synced log.
export class JobHistory extends Context.Service<
  JobHistory,
  {
    readonly repos: Effect.Effect<ReadonlyArray<string>, StateLogs.LogReadError>;
    readonly overview: (days: number) => Effect.Effect<Overview, StateLogs.LogReadError>;
    readonly jobSummaries: (input: Filter) => Effect.Effect<ReadonlyArray<JobSummary>, StateLogs.LogReadError>;
    readonly stepComparison: (input: Filter & { readonly job: string }) => Effect.Effect<StepComparison, StateLogs.LogReadError>;
    readonly runs: (input: Window & { readonly limit: number }) => Effect.Effect<ReadonlyArray<JobRun>, StateLogs.LogReadError>;
    readonly weeklySummary: (input: Window & { readonly by: GroupBy }) => Effect.Effect<WeeklySummary, StateLogs.LogReadError>;
  }
>()("runnerbox/server/JobHistory") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const since = (days: number) => Clock.currentTimeMillis.pipe(Effect.map((now) => now - days * DAY_MS));
  const inWorkflow = (workflow: string | undefined) => (record: { workflow: string | null }) =>
    workflow === undefined || record.workflow === workflow;

  const overview = Effect.fn("JobHistory.overview")(function* (days: number) {
    const jobs = yield* logs.allJobs(yield* since(days));
    const summaries = summarizeJobs(jobs);
    const ran = jobs.filter((job) => job.runner !== null && job.conclusion !== "skipped");
    const sum = (pick: (row: JobSummary) => number) => summaries.reduce((total, row) => total + pick(row), 0);
    const present = <T>(value: T | null): value is T => value !== null;
    return {
      repos: yield* logs.repos,
      jobs: sum((row) => row.ran),
      failed: sum((row) => row.failed),
      passedOnRetry: sum((row) => row.passedOnRetry),
      noRunner: sum((row) => row.noRunner),
      p50Ms: percentile(ran.filter((job) => job.conclusion === "success").map((job) => elapsedMs(job.startedAt, job.completedAt)).filter(present), 50),
      queueP50Ms: percentile(ran.map((job) => elapsedMs(job.createdAt, job.startedAt)).filter(present), 50),
    };
  });

  const jobSummaries = Effect.fn("JobHistory.jobSummaries")(function* ({ repo, days, by, workflow }: Filter) {
    const start = yield* since(days);
    const jobs = (yield* logs.jobs(repo, start)).filter(inWorkflow(workflow));
    return summarizeJobs(jobs, { by, machine: machineLookup(yield* logs.samples(start)) });
  });

  const stepComparison = Effect.fn("JobHistory.stepComparison")(function* (input: Filter & { readonly job: string }) {
    const jobs = (yield* logs.jobs(input.repo, yield* since(input.days))).filter(inWorkflow(input.workflow));
    const { runnerTypes, steps } = compareSteps(jobs, input.job, input.by);
    return {
      runnerTypes,
      steps: steps.map(({ name, p50MsByRunnerType }) => ({ name, p50MsByRunnerType: Object.fromEntries(p50MsByRunnerType) })),
    };
  });

  const runs = Effect.fn("JobHistory.runs")(function* ({ repo, days, limit }: Window & { readonly limit: number }) {
    const start = yield* since(days);
    const jobs = yield* logs.jobs(repo, start);
    const verdicts = verdictsByJobId(jobs, { machine: machineLookup(yield* logs.samples(start)), events: yield* logs.events(start) });
    return jobs
      .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
      .map(({ v: _v, labels, steps: _steps, ...job }) => ({
        ...job,
        runnerType: runnerType({ labels }),
        durationMs: elapsedMs(job.startedAt, job.completedAt),
        queueMs: job.runner === null ? null : elapsedMs(job.createdAt, job.startedAt),
        verdict: verdicts.get(job.jobId) ?? null,
      }));
  });

  const weeklySummary = Effect.fn("JobHistory.weeklySummary")(function* ({ repo, days, by }: Window & { readonly by: GroupBy }) {
    const now = yield* Clock.currentTimeMillis;
    const start = now - days * DAY_MS;
    const samples = yield* logs.samples(start);
    const events = yield* logs.events(start);
    return {
      repo,
      since: new Date(start).toISOString(),
      until: new Date(now).toISOString(),
      jobs: summarizeJobs(yield* logs.jobs(repo, start), { by, machine: machineLookup(samples) }),
      launcher: summarizeLauncher(events.map(({ install, ...record }) => ({ install, record }))),
      machines: summarizeMachines(samples),
    };
  });

  return JobHistory.of({ repos: logs.repos, overview, jobSummaries, stepComparison, runs, weeklySummary });
});

export const layer = Layer.effect(JobHistory, make);
