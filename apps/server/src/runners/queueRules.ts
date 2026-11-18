import type { QueueStatus, RunningJob, WaitingJob } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { REPO_NAME } from "runnerbox/src/github/github-client.ts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { median, present } from "../inbox/jobs.ts";
import type { Budget } from "../github/githubReader.ts";

export const MAX_REPOS = 10;
export const MAX_RUNS_PER_REPO = 10;
const NAME_CHARS = 100;
const SLOW_BELOW = 0.25;
const STOP_BELOW = 0.05;

// The repos to poll: names that pass the core's REPO_NAME pattern, so nothing else ever goes into
// a request path, the most recently active first, and at most MAX_REPOS of them.
export function reposToPoll(activity: ReadonlyArray<{ repo: string; lastAt: number }>) {
  const valid = activity.filter(({ repo }) => REPO_NAME.test(repo)).toSorted((a, b) => b.lastAt - a.lastAt);
  return { repos: valid.slice(0, MAX_REPOS).map(({ repo }) => repo), leftOut: Math.max(0, valid.length - MAX_REPOS) };
}

// GitHub's replies are outside input: only these fields are read, and anything else is ignored.
const Runs = Schema.Struct({
  workflow_runs: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      created_at: Schema.String,
      head_branch: Schema.optionalKey(Schema.NullOr(Schema.String)),
      head_repository: Schema.optionalKey(Schema.NullOr(Schema.Struct({ full_name: Schema.String }))),
      pull_requests: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ number: Schema.Number })))),
    }),
  ),
});
const Jobs = Schema.Struct({
  jobs: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      workflow_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      status: Schema.String,
      labels: Schema.Array(Schema.String),
      created_at: Schema.String,
      started_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
      runner_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      html_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

// The runs to look inside, at most MAX_RUNS_PER_REPO: queued runs first, the longest waiting first,
// since those are where jobs wait, then the newest in-progress runs, whose later jobs may still be
// queued. `leftOut` counts the queued runs that didn't fit. `refs` names each run's pull request,
// "#482", or else its branch. GitHub lists no pull request for one from a fork, so a fork's branch
// is named as GitHub writes it, "someone:main", and never reads as one of `repo`'s own.
export function runIds(repo: string, queued: unknown, inProgress: unknown) {
  const runs = (body: unknown) => Option.match(Schema.decodeUnknownOption(Runs)(body), { onNone: () => [], onSome: (decoded) => decoded.workflow_runs });
  const waiting = runs(queued).toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const running = runs(inProgress).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const ids = [...new Set([...waiting, ...running].map((run) => run.id))];
  const refOf = (run: (typeof waiting)[number]) => {
    if (run.pull_requests?.[0]) return `#${run.pull_requests[0].number}`;
    if (!run.head_branch) return null;
    const from = run.head_repository?.full_name;
    return cut(from && from !== repo ? `${from.split("/")[0]}:${run.head_branch}` : run.head_branch);
  };
  const refs = new Map([...waiting, ...running].map((run) => [run.id, refOf(run)]));
  return { ids: ids.slice(0, MAX_RUNS_PER_REPO), leftOut: Math.max(0, waiting.length - MAX_RUNS_PER_REPO), refs };
}

function cut(text: string) {
  return text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS - 1)}…` : text;
}

const jobKey = (repo: string, workflow: string | null, job: string) => `${repo}\0${workflow ?? ""}\0${job}`;

// Each job's typical time in the job log, from the runs that passed, keyed as `runningJobs` looks it up.
export function usualTimes(jobs: ReadonlyArray<JobRecord>) {
  const passed = jobs.filter((job) => job.conclusion === "success");
  return new Map(
    [...Map.groupBy(passed, (job) => jobKey(job.repo, job.workflow, job.job))].flatMap(([key, runs]) => {
      const typical = median(runs.map((run) => elapsedMs(run.startedAt, run.completedAt)).filter(present));
      return typical === null ? [] : [[key, typical] as const];
    }),
  );
}

// The jobs in one run's reply that one of `runners` is running now, each with its run's `ref` and
// its usual time. Names are cut short, and a URL is kept only when it's a github.com page.
export function runningJobs(repo: string, body: unknown, runners: ReadonlySet<string>, ref: string | null, usual: ReadonlyMap<string, number>): RunningJob[] {
  return Option.match(Schema.decodeUnknownOption(Jobs)(body), {
    onNone: () => [],
    onSome: ({ jobs }) =>
      jobs.flatMap((job) => {
        const runner = job.runner_name;
        if (job.status !== "in_progress" || !runner || !runners.has(runner)) return [];
        const workflow = job.workflow_name ?? null;
        const url = job.html_url?.startsWith("https://github.com/") ? job.html_url : null;
        return [{ runner, repo, workflow: workflow === null ? null : cut(workflow), job: cut(job.name), ref, since: job.started_at ?? job.created_at, url, usualMs: usual.get(jobKey(repo, workflow, job.name)) ?? null }];
      }),
  });
}

// The jobs in one run's reply still queued for one of `labels`. Names are cut short, and a URL is
// kept only when it's a github.com page.
export function waitingJobs(repo: string, body: unknown, labels: ReadonlySet<string>): WaitingJob[] {
  return Option.match(Schema.decodeUnknownOption(Jobs)(body), {
    onNone: () => [],
    onSome: ({ jobs }) =>
      jobs.flatMap((job) => {
        const label = job.labels.find((each) => labels.has(each));
        if (job.status !== "queued" || !label) return [];
        const url = job.html_url?.startsWith("https://github.com/") ? job.html_url : null;
        return [{ repo, workflow: job.workflow_name ? cut(job.workflow_name) : null, job: cut(job.name), label, since: job.created_at, url }];
      }),
  });
}

export type Timing = { pollMs: number; slowMs: number; maxBackoffMs: number };
export type Outcome =
  | { kind: "ok"; budget: Budget | null }
  // Every repo polled refused the token, each for itself.
  | { kind: "forbidden" }
  | { kind: "limited"; untilMs: number }
  | { kind: "refused"; status: number }
  | { kind: "error"; message: string };

// When to poll next after `outcome`, and what to tell the viewer. The budget decides the pace: a
// quarter left slows it to every few minutes, a twentieth stops it until the reset. GitHub saying
// to wait stops it until then. Anything else backs off, doubling up to `maxBackoffMs`.
export function afterPoll(outcome: Outcome, failures: number, timing: Timing, now: number) {
  const pause = (untilMs: number, reason: string) => ({
    delayMs: Math.max(untilMs - now, timing.pollMs),
    status: "paused" as QueueStatus,
    reason,
    resumesAt: new Date(Math.max(untilMs, now + timing.pollMs)).toISOString(),
    failures: 0,
  });
  const backOff = (reason: string) => ({
    delayMs: Math.min(timing.pollMs * 2 ** (failures + 1), timing.maxBackoffMs),
    status: "watching" as QueueStatus,
    reason,
    resumesAt: null,
    failures: failures + 1,
  });
  switch (outcome.kind) {
    case "limited":
      return pause(outcome.untilMs, "GitHub asked Runnerbox to wait before checking again.");
    case "refused":
      return backOff(`GitHub refused the token in report.env (${outcome.status}).`);
    case "forbidden":
      return backOff("The token in report.env can't read any of these repositories' Actions.");
    case "error":
      return backOff(`Couldn't check GitHub: ${outcome.message}.`);
    case "ok": {
      const share = outcome.budget ? outcome.budget.remaining / outcome.budget.limit : 1;
      if (outcome.budget && share < STOP_BELOW) return pause(outcome.budget.resetAt, "The GitHub token's hourly limit is nearly used, so Runnerbox stopped checking until it resets.");
      if (share < SLOW_BELOW) return { delayMs: timing.slowMs, status: "slowed" as QueueStatus, reason: "The GitHub token's hourly limit is getting low, so Runnerbox checks less often.", resumesAt: null, failures: 0 };
      return { delayMs: timing.pollMs, status: "watching" as QueueStatus, reason: null, resumesAt: null, failures: 0 };
    }
  }
}
