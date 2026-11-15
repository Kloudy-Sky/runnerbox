import type { JobTrend } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { durationMs, jobKey, median, present } from "../inbox/jobs.ts";

const DAY_MS = 24 * 60 * 60_000;
// A job has become slower when its typical time grew by this share over the window before, and by
// at least SLOWER_MIN_MS, so a 20 second job taking 26 isn't flagged.
const SLOWER_SHARE = 0.25;
const SLOWER_MIN_MS = 30_000;

const typical = (jobs: readonly JobRecord[]) => median(jobs.filter((job) => job.conclusion === "success").map(durationMs).filter(present));

// Each job and runner label of one repo over the last `days`, most runner time first: its typical
// time per day, and against the same length of time just before. `jobs` must cover both windows.
export function jobTrends(jobs: readonly JobRecord[], now: number, days: number): JobTrend[] {
  const since = now - days * DAY_MS;
  const ran = jobs.filter((job): job is JobRecord & { startedAt: string } => job.runner !== null && job.startedAt !== null && Date.parse(job.startedAt) >= since - days * DAY_MS);
  const groups = Map.groupBy(ran, (job) => `${jobKey(job)}\0${runnerType(job)}`);
  return [...groups.values()]
    .flatMap((group): JobTrend[] => {
      const recent = group.filter((job) => Date.parse(job.startedAt) >= since);
      if (recent.length === 0) return [];
      const earlier = group.filter((job) => Date.parse(job.startedAt) < since);
      const typicalMs = typical(recent);
      const earlierTypicalMs = typical(earlier);
      const byDay = Map.groupBy(recent, (job) => job.startedAt.slice(0, 10));
      const first = recent[0]!;
      return [
        {
          workflow: first.workflow,
          job: first.job,
          runnerType: runnerType(first),
          runs: recent.length,
          runnerMs: recent.reduce((sum, job) => sum + (durationMs(job) ?? 0), 0),
          typicalMs,
          earlierTypicalMs,
          slower: typicalMs !== null && earlierTypicalMs !== null && typicalMs - earlierTypicalMs >= Math.max(SLOWER_MIN_MS, earlierTypicalMs * SLOWER_SHARE),
          // The window touches `days + 1` UTC dates, the first and last only in part.
          days: Array.from({ length: days + 1 }, (_, index) => new Date(since + index * DAY_MS).toISOString().slice(0, 10)).map((day) => {
            const onDay = byDay.get(day) ?? [];
            return { day, runs: onDay.length, typicalMs: typical(onDay) };
          }),
        },
      ];
    })
    .toSorted((a, b) => b.runnerMs - a.runnerMs);
}
