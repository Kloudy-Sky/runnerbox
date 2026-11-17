import type { DayTotals, Review } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { median, present } from "../inbox/jobs.ts";
import { jobTotals } from "./jobTotals.ts";

const DAY_MS = 24 * 60 * 60_000;
const dateOf = (time: string | number) => new Date(time).toISOString().slice(0, 10);

// Jobs and reviews added up per UTC date, as `jobTrends` dates its days: the window touches
// `days + 1` dates, the first and last only in part. A job is dated by when it was queued, the
// time the job log's window is cut by, so every job in the window lands on one of the dates.
// Reviews are dated by when they started.
export function totalsByDay(input: { readonly jobs: readonly JobRecord[]; readonly reviews: readonly Review[]; readonly now: number; readonly days: number }): DayTotals[] {
  const since = input.now - input.days * DAY_MS;
  const jobsByDay = Map.groupBy(input.jobs, (job) => dateOf(job.createdAt));
  const reviewsByDay = Map.groupBy(
    input.reviews.filter((review) => Date.parse(review.startedAt) >= since),
    (review) => dateOf(review.startedAt),
  );
  return Array.from({ length: input.days + 1 }, (_, index) => dateOf(since + index * DAY_MS)).map((day) => {
    const reviews = reviewsByDay.get(day) ?? [];
    const finished = reviews.filter((review) => review.state === "done");
    return {
      day,
      ...jobTotals(jobsByDay.get(day) ?? []),
      reviews: finished.length,
      reviewsWithFindings: finished.filter((review) => review.findings.length > 0).length,
      typicalReviewMs: median(finished.map((review) => elapsedMs(review.startedAt, review.finishedAt)).filter(present)),
      reviewCostUsd: reviews.reduce((sum, review) => sum + (review.costUsd ?? 0), 0),
    };
  });
}
