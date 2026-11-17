import type { PullRequest } from "@runnerbox/contracts";
import { going } from "./reviewWords.ts";

// Where an open pull request stands with its review. Only a finished review of the newest commit
// can say it's safe or has something to fix; anything older, failed or missing is unreviewed.
export const STANDINGS = ["safe", "reviewing", "fix", "unreviewed"] as const;
export type Standing = (typeof STANDINGS)[number];

export const standingWords = { safe: "Safe to merge", reviewing: "Being reviewed", fix: "Something to fix", unreviewed: "Not reviewed" } as const satisfies Record<Standing, string>;

export function standingOf(pull: PullRequest): Standing {
  const review = pull.review;
  if (going(review)) return "reviewing";
  if (review?.state !== "done" || (pull.headSha !== "" && review.headSha !== pull.headSha)) return "unreviewed";
  return review.p1 + review.p2 > 0 ? "fix" : "safe";
}
