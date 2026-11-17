import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRun } from "@runnerbox/contracts";
import { waitGrid, waitSentence } from "./waitsByHour.ts";

const run = (createdAt: Date, queueMs: number | null): JobRun => ({
  repo: "owner/name", jobId: 1, runId: 1, attempt: 1, workflow: null, job: "test", branch: null, headSha: null, conclusion: "success", runner: null, runnerType: "linux",
  createdAt: createdAt.toISOString(), startedAt: null, completedAt: null, durationMs: null, queueMs, verdict: null, starved: false,
});
// Local times, since the grid is in the viewer's own week. 2026-11-17 is a Tuesday.
const tuesdayAt10 = new Date(2026, 10, 17, 10, 15);

test("waits land on their local weekday and hour, Monday first, with the typical one shown", () => {
  const grid = waitGrid([run(tuesdayAt10, 10_000), run(tuesdayAt10, 30_000), run(tuesdayAt10, 20_000), run(tuesdayAt10, null)]);
  assert.deepEqual(grid[1]![10], { jobs: 3, typicalMs: 20_000 });
  assert.equal(grid.flat().reduce((jobs, cell) => jobs + cell.jobs, 0), 3);
  assert.equal(waitSentence(grid), "Jobs wait longest on Tuesdays from 10:00, typically 20s.");
});
