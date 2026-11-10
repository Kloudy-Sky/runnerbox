import * as Schema from "effect/Schema";

export const RepoName = Schema.String.check(Schema.isPattern(/^[\w.-]+\/[\w.-]+$/));
// How many days back from now, as the CLI's `--since <days>d` counts them.
export const Days = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 }));
export const GroupBy = Schema.Literals(["labels", "runner"]);
export type GroupBy = typeof GroupBy.Type;

const NullableNumber = Schema.NullOr(Schema.Number);
const NullableString = Schema.NullOr(Schema.String);

export const JobSummary = Schema.Struct({
  workflow: NullableString,
  job: Schema.String,
  runnerType: Schema.String,
  ran: Schema.Number,
  failed: Schema.Number,
  passedOnRetry: Schema.Number,
  noRunner: Schema.Number,
  p50Ms: NullableNumber,
  p90Ms: NullableNumber,
  queueP50Ms: NullableNumber,
  queueP90Ms: NullableNumber,
  totalMs: Schema.Number,
  vmLowP50MiB: NullableNumber,
  hostLowP50MiB: NullableNumber,
  vmSwapP90MiB: NullableNumber,
});
export type JobSummary = typeof JobSummary.Type;

export const StepComparison = Schema.Struct({
  runnerTypes: Schema.Array(Schema.String),
  steps: Schema.Array(
    Schema.Struct({ name: Schema.String, p50MsByRunnerType: Schema.Record(Schema.String, NullableNumber) }),
  ),
});
export type StepComparison = typeof StepComparison.Type;

// `unconfirmed` is a failure with one attempt on one runner type and nothing pointing at the
// machine, so a re-run is what tells code from flaky.
export const Verdict = Schema.Literals(["code", "flaky", "infra", "unconfirmed"]);
export type Verdict = typeof Verdict.Type;

export const Step = Schema.Struct({ name: Schema.String, conclusion: NullableString, ms: NullableNumber });

// One job attempt, as the run list shows it.
export const JobRun = Schema.Struct({
  repo: Schema.String,
  jobId: Schema.Number,
  runId: Schema.Number,
  attempt: Schema.Number,
  workflow: NullableString,
  job: Schema.String,
  branch: NullableString,
  conclusion: NullableString,
  runner: NullableString,
  runnerType: Schema.String,
  createdAt: Schema.String,
  startedAt: NullableString,
  completedAt: NullableString,
  durationMs: NullableNumber,
  queueMs: NullableNumber,
  verdict: Schema.NullOr(Verdict),
});
export type JobRun = typeof JobRun.Type;

export const LauncherRow = Schema.Struct({
  install: Schema.String,
  runnerType: Schema.String,
  runners: Schema.Number,
  failedRunners: Schema.Number,
  releasedForMemory: Schema.Number,
  releasedForImage: Schema.Number,
  memoryWaits: Schema.Number,
  memoryWaitP90Ms: NullableNumber,
  imageBuilds: Schema.Number,
  failedBuilds: Schema.Number,
  buildP50Ms: NullableNumber,
});
export type LauncherRow = typeof LauncherRow.Type;

export const MachineRow = Schema.Struct({
  install: Schema.String,
  samples: Schema.Number,
  vmAvailableP10MiB: NullableNumber,
  vmAvailableMinMiB: NullableNumber,
  vmSwapP90MiB: NullableNumber,
  hostAvailableP10MiB: NullableNumber,
});
export type MachineRow = typeof MachineRow.Type;

export const WeeklySummary = Schema.Struct({
  repo: Schema.String,
  since: Schema.String,
  until: Schema.String,
  jobs: Schema.Array(JobSummary),
  launcher: Schema.Array(LauncherRow),
  machines: Schema.Array(MachineRow),
});
export type WeeklySummary = typeof WeeklySummary.Type;

// The figures across the top of the inbox, over every repo with a job log.
export const Overview = Schema.Struct({
  repos: Schema.Array(Schema.String),
  jobs: Schema.Number,
  failed: Schema.Number,
  passedOnRetry: Schema.Number,
  noRunner: Schema.Number,
  p50Ms: NullableNumber,
  queueP50Ms: NullableNumber,
});
export type Overview = typeof Overview.Type;
