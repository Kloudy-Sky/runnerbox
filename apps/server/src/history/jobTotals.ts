import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { durationMs, isFailure, median, present } from "../inbox/jobs.ts";

// What a set of jobs adds up to, for the inbox's headline and the totals by day alike. A job
// counts when it got a runner and wasn't skipped; time is on the owner's machines when the job
// asked for `self-hosted`.
export function jobTotals(jobs: readonly JobRecord[]) {
  const ran = jobs.filter((job) => job.runner !== null && job.conclusion !== "skipped");
  const time = (own: boolean) =>
    ran.filter((job) => job.labels.includes("self-hosted") === own).reduce((sum, job) => sum + (durationMs(job) ?? 0), 0);
  return {
    jobs: ran.length,
    passed: ran.filter((job) => job.conclusion === "success").length,
    failed: ran.filter(isFailure).length,
    typicalWaitMs: median(ran.map((job) => elapsedMs(job.createdAt, job.startedAt)).filter(present)),
    ownMachinesMs: time(true),
    githubMachinesMs: time(false),
  };
}
