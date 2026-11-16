import assert from "node:assert/strict";
import { test } from "node:test";
import type { Review, ReviewSummary } from "@runnerbox/contracts";
import { fixPrompt, reviewState } from "./reviewWords.ts";

const summary = (change: Partial<ReviewSummary>): ReviewSummary => ({ id: "r", state: "done", headSha: "a".repeat(40), startedAt: "2026-11-15T10:00:00Z", finishedAt: "2026-11-15T10:01:00Z", score: 4, impact: "low", p1: 0, p2: 0, ...change });

test("a finished review reads as clean, held, or behind the pull request's newest commit", () => {
  assert.equal(reviewState(summary({}), "a".repeat(40)), "Clean");
  assert.equal(reviewState(summary({ p2: 1 }), "a".repeat(40)), "Held for you");
  assert.equal(reviewState(summary({ p1: 1 }), "b".repeat(40)), "New commits since");
  assert.equal(reviewState(summary({ state: "running", p1: 0 }), "b".repeat(40)), "Reviewing");
});

test("the fix prompt names where each finding is and asks for it to be checked first", () => {
  const review: Review = {
    id: "r", repo: "owner/name", number: 7, title: "A change", author: "someone", branch: "fix/widget", base: "main", headSha: "abcdef0".padEnd(40, "0"), additions: 3, deletions: 1, changedFiles: 1,
    state: "done", startedAt: "2026-11-15T10:00:00Z", finishedAt: "2026-11-15T10:01:00Z", model: "opus", costUsd: null, filesRead: 2, score: 3, impact: "medium", reach: "The widget.", verdict: "Fix it.", problem: null,
    findings: [{ priority: "P1", title: "A waiting job has no label", path: "src/queue.ts", startLine: 8, endLine: 10, body: "It throws.", rule: null, code: [] }],
  };
  assert.equal(
    fixPrompt(review),
    "Fix these review findings on owner/name pull request #7, branch fix/widget, as of commit abcdef0.\nCheck each against the code first. Fix the ones that hold, and say why for any that don't.\n\n1. [P1] A waiting job has no label\n   src/queue.ts:8-10\n   It throws.",
  );
});
