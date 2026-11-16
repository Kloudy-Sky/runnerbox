import type { Review, ReviewSummary } from "@runnerbox/contracts";

// Reviews in the owner's words. A review that's done was posted nowhere, so its findings are held.

export const going = (review: { readonly state: ReviewSummary["state"] } | undefined) => review?.state === "queued" || review?.state === "running";

// `headSha` is the pull request's newest commit, which the review may be behind.
export function reviewState(review: ReviewSummary, headSha: string) {
  switch (review.state) {
    case "queued":
      return "Waiting";
    case "running":
      return "Reviewing";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "done":
      if (headSha !== "" && review.headSha !== headSha) return "New commits since";
      return review.p1 + review.p2 === 0 ? "Clean" : "Held for you";
  }
}

export const impactWords = { low: "Low", medium: "Medium", high: "High", critical: "Critical" } as const;

export const lineRange = (finding: { readonly path: string; readonly startLine: number; readonly endLine: number }) =>
  `${finding.path}:${finding.startLine}${finding.endLine > finding.startLine ? `-${finding.endLine}` : ""}`;

// What to hand a coding agent to fix a review's findings: where each one is and what's wrong, and
// nothing about how the reviewer got there.
export function fixPrompt(review: Review) {
  const findings = review.findings.map((finding, index) => `${index + 1}. [${finding.priority}] ${finding.title}\n   ${lineRange(finding)}\n   ${finding.body}`);
  return [
    `Fix these review findings on ${review.repo} pull request #${review.number}, branch ${review.branch}, as of commit ${review.headSha.slice(0, 7)}.`,
    "Check each against the code first. Fix the ones that hold, and say why for any that don't.",
    "",
    ...findings,
  ].join("\n");
}
