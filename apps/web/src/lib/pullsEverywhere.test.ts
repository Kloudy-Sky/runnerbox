import assert from "node:assert/strict";
import { test } from "node:test";
import type { Check, PullRequest, ReviewsView } from "@runnerbox/contracts";
import { pullsEverywhere } from "./pullsEverywhere.ts";

const check = (name: string): Check => ({ name, workflow: "ci", state: "passed", startedAt: null, durationMs: null });
const pull = (number: number, change: Partial<PullRequest> = {}): PullRequest => ({
  repo: "owner/name", number, title: "A change", author: "someone", branch: "fix", base: "main", headSha: "a".repeat(40), draft: false, openedAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z", ...change,
});
const view = (pulls: ReadonlyArray<PullRequest>): ReviewsView => ({ app: null, repos: [], pulls, problem: null, checkedAt: null, canConfigure: true, canReview: true });

test("the same pull request from two machines shows once, from the machine that reviewed it, with both machines' checks", () => {
  const reviewed = pull(40, { checks: [check("lint")], review: { id: "r", state: "done", headSha: "a".repeat(40), startedAt: "2026-11-15T10:05:00Z", finishedAt: null, score: 5, impact: "low", p1: 0, p2: 0 } });
  const merged = pullsEverywhere([
    { environmentId: "laptop", view: view([pull(40, { checks: [check("e2e")] }), pull(41, { updatedAt: "2026-11-15T11:00:00Z" })]) },
    { environmentId: "box", view: view([reviewed]) },
    { environmentId: "offline", view: undefined },
  ]);
  assert.deepEqual(
    merged.map(({ pull, environmentId }) => [pull.number, environmentId, pull.checks?.map((each) => each.name)]),
    [
      [41, "laptop", undefined],
      [40, "box", ["lint", "e2e"]],
    ],
  );
});
