import type { GroupBy, JobResources, JobRun, JobSummary, JobTrend, KindUsageReport, Overview, RepoRuns, StepComparison, WeeklySummary } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { elapsedMs } from "runnerbox/src/tracking/job-record.ts";
import { summarizeLauncher } from "runnerbox/src/tracking/launcher-summary.ts";
import { summarizeMachines } from "runnerbox/src/tracking/machine-summary.ts";
import { compareSteps, percentile, summarizeJobs } from "runnerbox/src/tracking/report.ts";
import { verdictsByJobId } from "../inbox/rules.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { JobNotFound } from "./JobNotFound.ts";
import { jobResources } from "./jobResources.ts";
import { jobTrends } from "./jobTrends.ts";
import { kindUsage } from "./kindUsage.ts";
import { machineFit } from "./machineFit.ts";
import { toJobRun } from "./jobRun.ts";
import { machineLookup } from "./machineLookup.ts";
import { whereRan } from "./whereRan.ts";
import * as StateLogs from "./StateLogs.ts";

const DAY_MS = 24 * 60 * 60_000;
// The longest window the app or the agent asks for, so any job they list can be opened.
const JOB_LOOKBACK_DAYS = 90;

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
    readonly jobResources: (input: { readonly repo: string; readonly jobId: number }) => Effect.Effect<JobResources, StateLogs.LogReadError | JobNotFound>;
    readonly kindUsage: (days: number) => Effect.Effect<KindUsageReport, StateLogs.LogReadError>;
    readonly jobTrends: (input: Window) => Effect.Effect<ReadonlyArray<JobTrend>, StateLogs.LogReadError>;
    readonly whereRan: (days: number) => Effect.Effect<ReadonlyArray<RepoRuns>, StateLogs.LogReadError>;
  }
>()("runnerbox/server/JobHistory") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const runnerState = yield* RunnerState.RunnerState;
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
      .map((record) => toJobRun(record, verdicts.get(record.jobId) ?? null));
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

  const resources = Effect.fn("JobHistory.jobResources")(function* ({ repo, jobId }: { readonly repo: string; readonly jobId: number }) {
    const now = yield* Clock.currentTimeMillis;
    const jobs = yield* logs.jobs(repo, now - JOB_LOOKBACK_DAYS * DAY_MS);
    const job = jobs.find((record) => record.jobId === jobId);
    if (!job) return yield* new JobNotFound({ jobId });
    // Readings from a minute before the job, so its first sample isn't cut off by the filter.
    const from = Date.parse(job.startedAt ?? job.createdAt) - 60_000;
    // A runner's event starts when it registered, which can be hours before it took this job, so
    // events are kept by when they ended. The log is read whole either way.
    const events = (yield* logs.events(0)).filter((event) => Date.parse(event.startedAt) + event.durationMs >= from);
    const samples = yield* logs.samples(from);
    const verdict = verdictsByJobId(jobs, { machine: machineLookup(samples), events }).get(jobId) ?? null;
    return jobResources({ now, job, verdict, events, installs: yield* runnerState.current, samples, containerSamples: yield* logs.containerSamples(from) });
  });

  const usage = Effect.fn("JobHistory.kindUsage")(function* (days: number) {
    const now = yield* Clock.currentTimeMillis;
    const start = now - days * DAY_MS;
    const samples = yield* logs.samples(start);
    const events = yield* logs.events(start);
    const installs = yield* runnerState.current;
    const report = kindUsage({ now, jobs: yield* logs.allJobs(start), machine: machineLookup(samples), events, installs }, days);
    // Every machine known, by its live state, its events or its samples, so one with no samples still says so.
    const names = [...new Set([...installs.map((state) => state.install), ...events.map((event) => event.install), ...samples.map((sample) => sample.install)])].toSorted();
    // The VM's free memory is the install's, so its line is the install's floor; kinds with a lower
    // floor of their own are named, since their jobs didn't wait for it. A machine whose `up` is
    // too old to record it reads as not saying, and its sentence says so.
    const floorOf = (install: string) => {
      const state = installs.find((each) => each.install === install);
      const vmMiB = state?.memoryFloor?.vmMiB;
      if (vmMiB === undefined) return null;
      return { vmMiB, lowerKinds: (state?.kinds ?? []).filter((kind) => kind.memoryFloor && kind.memoryFloor.vmMiB < vmMiB).map((kind) => kind.name) };
    };
    return { ...report, machines: machineFit(names, floorOf, samples, report.kinds) };
  });

  // Twice the window, so each job's time can be set against the same length of time before it.
  const trends = Effect.fn("JobHistory.jobTrends")(function* ({ repo, days }: Window) {
    const now = yield* Clock.currentTimeMillis;
    return jobTrends(yield* logs.jobs(repo, now - 2 * days * DAY_MS), now, days);
  });

  const ran = Effect.fn("JobHistory.whereRan")(function* (days: number) {
    return whereRan(yield* logs.allJobs(yield* since(days)));
  });

  return JobHistory.of({ repos: logs.repos, overview, jobSummaries, stepComparison, runs, weeklySummary, jobResources: resources, kindUsage: usage, jobTrends: trends, whereRan: ran });
});

export const layer = Layer.effect(JobHistory, make);
