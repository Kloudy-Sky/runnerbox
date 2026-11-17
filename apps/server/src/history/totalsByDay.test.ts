import assert from "node:assert/strict";
import { test } from "node:test";
import type { Review, ReviewFinding } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { totalsByDay } from "./totalsByDay.ts";

const NOW = Date.parse("2026-06-15T12:00:00Z");
let id = 1;
const job = (createdAt: string, fields: { waitS: number; ranS: number; conclusion: string | null; hosted?: boolean; runner?: string | null }): JobRecord => {
  const started = Date.parse(createdAt) + fields.waitS * 1000;
  return {
    v: 1, repo: "owner/name", workflow: "ci", job: "build", jobId: id++, runId: id, attempt: 1, branch: "main", conclusion: fields.conclusion,
    runner: fields.runner === undefined ? "example-linux-1" : fields.runner, labels: fields.hosted ? ["ubuntu-latest"] : ["self-hosted", "example-linux"],
    createdAt, startedAt: new Date(started).toISOString(), completedAt: new Date(started + fields.ranS * 1000).toISOString(), steps: [],
  };
};
const finding: ReviewFinding = { priority: "P2", title: "Off by one", path: "src/queue.ts", startLine: 3, endLine: 3, body: "", rule: null, code: [] };
const review = (startedAt: string, fields: { state: Review["state"]; minutes: number; costUsd: number | null; findings?: ReviewFinding[] }): Review => ({
  id: `review-${id++}`, repo: "owner/name", number: 7, title: "Fix the queue", author: "someone", branch: "fix", base: "main", headSha: "a".repeat(40),
  additions: 1, deletions: 1, changedFiles: 1, state: fields.state, startedAt, finishedAt: new Date(Date.parse(startedAt) + fields.minutes * 60_000).toISOString(),
  model: "example", costUsd: fields.costUsd, filesRead: 0, score: null, impact: null, reach: null, verdict: null, findings: fields.findings ?? [], problem: null,
});

test("a day adds up its jobs and reviews, and a day with nothing on it is still there, as zeros", () => {
  const days = totalsByDay({
    now: NOW,
    days: 2,
    jobs: [
      job("2026-06-14T10:00:00Z", { waitS: 10, ranS: 60, conclusion: "success" }),
      job("2026-06-14T11:00:00Z", { waitS: 30, ranS: 120, conclusion: "failure", hosted: true }),
      // Cancelled jobs ran and took time, but neither passed nor failed.
      job("2026-06-14T12:00:00Z", { waitS: 20, ranS: 30, conclusion: "cancelled" }),
      job("2026-06-14T13:00:00Z", { waitS: 0, ranS: 0, conclusion: "skipped" }),
      job("2026-06-14T14:00:00Z", { waitS: 0, ranS: 0, conclusion: "cancelled", runner: null }),
    ],
    reviews: [
      review("2026-06-14T09:00:00Z", { state: "done", minutes: 4, costUsd: 0.5, findings: [finding] }),
      review("2026-06-14T10:00:00Z", { state: "done", minutes: 2, costUsd: 0.25 }),
      // A failed review isn't one that ran, but what it spent was spent.
      review("2026-06-14T11:00:00Z", { state: "failed", minutes: 1, costUsd: 0.125 }),
      // Before the window.
      review("2026-06-10T09:00:00Z", { state: "done", minutes: 3, costUsd: 1 }),
    ],
  });
  assert.deepEqual(days, [
    { day: "2026-06-13", jobs: 0, passed: 0, failed: 0, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, reviews: 0, reviewsWithFindings: 0, typicalReviewMs: null, reviewCostUsd: 0 },
    { day: "2026-06-14", jobs: 3, passed: 1, failed: 1, typicalWaitMs: 20_000, ownMachinesMs: 90_000, githubMachinesMs: 120_000, reviews: 2, reviewsWithFindings: 1, typicalReviewMs: 120_000, reviewCostUsd: 0.875 },
    { day: "2026-06-15", jobs: 0, passed: 0, failed: 0, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, reviews: 0, reviewsWithFindings: 0, typicalReviewMs: null, reviewCostUsd: 0 },
  ]);
});
