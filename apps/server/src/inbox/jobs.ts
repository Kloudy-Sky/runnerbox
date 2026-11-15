import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { percentile } from "runnerbox/src/tracking/report.ts";

// What the inbox rules say about job records, and how they say numbers to someone new to CI.

export const DAY_MS = 24 * 60 * 60_000;
// The core's rule for a job that waited for a runner and never got one, so the CLI and the app agree.
export { STARVED_AFTER_MS, starved } from "runnerbox/src/tracking/report.ts";

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

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
// Memory by the same rule as `formatMiB` in apps/web/src/lib/format.ts, so a sentence and the screen
// beside it never give one machine two numbers: GB to one decimal from 1024 MiB, whole MB below.
// It's 1024-based, but labelled GB and MB, which is what the owner calls them. Change both together.
export const memory = (valueMiB: number) => (valueMiB >= 1024 ? `${(valueMiB / 1024).toFixed(1)} GB` : `${Math.round(valueMiB)} MB`);

// A part and its whole in the whole's unit, so one sentence never mixes MB and GB: "0.6 GB of 16.0 GB".
// A part that would round to 0.0 GB is "under 0.1 GB", so a machine that ran dry never reads as
// empty. Mirrors `formatMiBOf` in apps/web/src/lib/format.ts.
export const memoryOf = (partMiB: number, wholeMiB: number) => ({
  part: wholeMiB < 1024 ? memory(partMiB) : partMiB < 0.05 * 1024 ? "under 0.1 GB" : `${(partMiB / 1024).toFixed(1)} GB`,
  whole: memory(wholeMiB),
});

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
