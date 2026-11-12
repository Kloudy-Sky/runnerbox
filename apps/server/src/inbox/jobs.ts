import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { percentile } from "runnerbox/src/tracking/report.ts";

// What the inbox rules say about job records, and how they say numbers to someone new to CI.

export const DAY_MS = 24 * 60 * 60_000;
// A job that ended without a runner after less than this was cancelled, usually by a newer push,
// not left waiting.
export const STARVED_AFTER_MS = 5 * 60_000;

export const isFailure = ({ conclusion }: JobRecord) => conclusion === "failure" || conclusion === "timed_out";
export const durationMs = (job: JobRecord) => elapsedMs(job.startedAt, job.completedAt);
export const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;
export const median = (values: readonly number[]) => percentile(values, 50);
// Attempts of a job on one commit, across every run and runner type. Records from before the
// commit was recorded fall back to one run, which is always one commit.
export const unitKey = (job: JobRecord) => `${job.repo}\0${job.headSha ? `sha:${job.headSha}` : `run:${job.runId}`}\0${job.workflow}\0${job.job}`;
export const sameUnit = (a: JobRecord, b: JobRecord) => unitKey(a) === unitKey(b);
// Attempt numbers restart in each run, so attempts on a commit are ordered by when they started.
export const startedMs = (job: JobRecord) => Date.parse(job.startedAt ?? job.createdAt);
export const jobKey = (job: JobRecord) => `${job.repo}\0${job.workflow}\0${job.job}`;
export const jobName = (job: Pick<JobRecord, "workflow" | "job">) => (job.workflow ? `${job.workflow} / ${job.job}` : job.job);
export const at = (job: JobRecord) => job.completedAt ?? job.startedAt ?? job.createdAt;

// Never got a runner, after waiting long enough that it wasn't just cancelled.
export const starved = (job: JobRecord) =>
  job.runner === null && job.conclusion !== "skipped" && (elapsedMs(job.createdAt, job.completedAt) ?? 0) >= STARVED_AFTER_MS;

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
export const mib = (value: number) => `${Math.round(value).toLocaleString("en-US")} MiB`;

// "45 seconds", "12 minutes", "2.5 hours": how long, the way a person says it.
export function plainDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return plural(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return plural(minutes, "minute");
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours.toLocaleString("en-US")} ${hours === 1 ? "hour" : "hours"}`;
}

// "a and b", "a, b and c".
export const listed = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
