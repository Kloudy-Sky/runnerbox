import assert from "node:assert/strict";
import { test } from "node:test";
import type { PullRequest, ReviewSummary } from "@runnerbox/contracts";
import { standingOf } from "./pullStanding.ts";

const head = "a".repeat(40);
const pull = (review?: Partial<ReviewSummary>): PullRequest => ({
  repo: "owner/name", number: 7, title: "A change", author: "someone", branch: "fix", base: "main", headSha: head, draft: false, openedAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z",
  ...(review ? { review: { id: "r", state: "done", headSha: head, startedAt: "2026-11-15T10:00:00Z", finishedAt: null, score: 5, impact: "low", p1: 0, p2: 0, ...review } } : {}),
});

test("only a finished review of the newest commit says safe to merge or something to fix", () => {
  assert.equal(standingOf(pull({})), "safe");
  assert.equal(standingOf(pull({ p2: 1 })), "fix");
  assert.equal(standingOf(pull({ headSha: "b".repeat(40) })), "unreviewed");
  assert.equal(standingOf(pull({ state: "failed" })), "unreviewed");
  assert.equal(standingOf(pull({ state: "queued" })), "reviewing");
  assert.equal(standingOf(pull()), "unreviewed");
});
