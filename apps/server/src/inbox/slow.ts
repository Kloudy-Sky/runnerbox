import type { InboxItem } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { at, durationMs, jobKey, jobName, median, plainDuration, present } from "./jobs.ts";
import { evidenceFor, type InboxInput } from "./rules.ts";

// A run counts as slow when it took this much longer than the job's typical time, and at least a minute.
const SLOW_FACTOR = 1.5;
const SLOW_MIN_EXTRA_MS = 60_000;
const SLOW_MIN_HISTORY = 5;
// A duration is usual for a job when at least this share of its earlier runs (and two of them)
// took about as long or longer. A job whose runs fall in two clusters, such as one that sometimes
// rebuilds a cache, isn't slow when it lands in the upper one.
const USUAL_SHARE = 0.2;
const ABOUT = 0.85;

function isUsual(ms: number, earlier: readonly number[]) {
  const asLong = earlier.filter((other) => other >= ms * ABOUT).length;
  return asLong >= 2 && asLong >= earlier.length * USUAL_SHARE;
}

export function slowerThan(job: JobRecord, before: readonly JobRecord[]) {
  const earlier = before.map(durationMs).filter(present);
  const typical = median(earlier);
  const ms = durationMs(job)!;
  return typical !== null && ms > typical * SLOW_FACTOR && ms - typical >= SLOW_MIN_EXTRA_MS && !isUsual(ms, earlier);
}

// Passing jobs slower than their own history on the same kind of runner. Three in a row is a change
// worth the owner's time; one is chance, and quiet.
export function slowItems(input: InboxInput): InboxItem[] {
  const passed = input.jobs.filter((job) => job.conclusion === "success" && job.runner !== null && durationMs(job) !== null);
  const groups = Map.groupBy(passed, (job) => `${jobKey(job)}\0${runnerType(job)}`);
  return [...groups.values()].flatMap((group) => {
    const sorted = group.toSorted((a, b) => Date.parse(a.startedAt!) - Date.parse(b.startedAt!));
    if (sorted.length <= SLOW_MIN_HISTORY) return [];
    const latest = sorted.at(-1)!;
    // Three slow runs in a row is a regression, not noise. Each is judged against the history
    // before the three, so the streak doesn't make itself look usual.
    const regression = sorted.length >= SLOW_MIN_HISTORY + 3 && sorted.slice(-3).every((job) => slowerThan(job, sorted.slice(0, -3)));
    if (!regression && !slowerThan(latest, sorted.slice(0, -1))) return [];
    const before = regression ? sorted.slice(0, -3) : sorted.slice(0, -1);
    const typical = median(before.map(durationMs).filter(present))!;
    const label = runnerType(latest);
    const name = jobName(latest);
    const took = plainDuration(durationMs(latest)!);
    return [
      {
        id: `slow_job:${jobKey(latest)}:${label}`,
        kind: "slow_job",
        group: regression ? "needs_you" : "quiet",
        quiet: regression ? null : "slow",
        verdict: null,
        repo: latest.repo,
        install: null,
        title: regression ? `${name} has become slower on ${label}` : `${name} was slower than usual on ${label}`,
        happened: regression
          ? `Its last 3 runs each took over ${plainDuration(typical * SLOW_FACTOR)}, against a typical ${plainDuration(typical)}. The latest took ${took}.`
          : `Its latest run took ${took}, against a typical ${plainDuration(typical)}.`,
        why: regression
          ? "Three slow runs in a row point at a change in the job or on the machine, not chance."
          : "One slow run is often chance: a busy machine or a slow download.",
        action: regression ? "Compare each step with its usual time to see which one grew." : "Nothing to do unless it happens again.",
        at: at(latest),
        evidence: {
          ...evidenceFor(latest, [latest], input.jobs, input),
          durations: sorted.map((job) => ({ startedAt: job.startedAt!, ms: durationMs(job)! })),
          reasons: [`it took ${Math.round((durationMs(latest)! / typical) * 10) / 10} times its typical time over ${sorted.length - 1} earlier runs`],
        },
      } satisfies InboxItem,
    ];
  });
}
