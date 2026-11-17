import type { PullRequest } from "@runnerbox/contracts";
import { going } from "./reviewWords.ts";

// Where an open pull request stands: safe to merge only when a finished review of the newest commit
// found nothing and no check failed or is still going. A failed check or a finding is something to
// fix. A review or check still going is in progress, and a review that's missing, failed or older
// than the newest commit leaves it unreviewed. A server older than checks reports none, so only its
// review counts.
export const STANDINGS = ["safe", "going", "fix", "unreviewed"] as const;
export type Standing = (typeof STANDINGS)[number];

export const standingWords = { safe: "Safe to merge", going: "Being reviewed or checked", fix: "Something to fix", unreviewed: "Not reviewed" } as const satisfies Record<Standing, string>;

// Whether the newest review is of the newest commit and found something.
export const hasFindings = (pull: PullRequest) => {
  const review = pull.review;
  return review?.state === "done" && (pull.headSha === "" || review.headSha === pull.headSha) && review.p1 + review.p2 > 0;
};

export function standingOf(pull: PullRequest): Standing {
  const checks = pull.checks ?? [];
  const review = pull.review;
  if (checks.some((check) => check.state === "failed") || hasFindings(pull)) return "fix";
  if (going(review)) return "going";
  if (review?.state !== "done" || (pull.headSha !== "" && review.headSha !== pull.headSha)) return "unreviewed";
  return checks.some((check) => check.state === "running" || check.state === "waiting") ? "going" : "safe";
}
