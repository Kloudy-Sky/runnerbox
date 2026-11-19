import type { RepoRuns } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";

// How many of each repository's jobs ran on self-hosted runners and how many on GitHub's, for the
// runs bar beside Where CI runs' switch. A job counts as `jobTotals` counts it: it got a runner and
// wasn't skipped.
export function whereRan(jobs: readonly JobRecord[]): ReadonlyArray<RepoRuns> {
  const byRepo = new Map<string, { here: number; github: number }>();
  for (const job of jobs) {
    if (job.runner === null || job.conclusion === "skipped") continue;
    const counts = byRepo.get(job.repo) ?? { here: 0, github: 0 };
    if (job.labels.includes("self-hosted")) counts.here += 1;
    else counts.github += 1;
    byRepo.set(job.repo, counts);
  }
  return [...byRepo].map(([repo, counts]) => ({ repo, ...counts })).toSorted((a, b) => a.repo.localeCompare(b.repo));
}
