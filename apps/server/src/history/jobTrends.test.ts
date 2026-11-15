import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { jobTrends } from "./jobTrends.ts";

const NOW = Date.parse("2026-06-15T12:00:00Z");
const DAY = 24 * 60 * 60_000;
let id = 1;
const run = (daysAgo: number, seconds: number, job = "build", installSeconds = 20): JobRecord => {
  const start = NOW - daysAgo * DAY;
  return {
    v: 1, repo: "owner/name", workflow: "ci", job, jobId: id++, runId: id, attempt: 1, branch: "main", conclusion: "success",
    runner: "example-linux-1-1780000000", labels: ["self-hosted", "example-linux"],
    createdAt: new Date(start - 5_000).toISOString(), startedAt: new Date(start).toISOString(), completedAt: new Date(start + seconds * 1000).toISOString(),
    steps: [{ name: "Install", conclusion: "success", ms: installSeconds * 1000 }, { name: "Build", conclusion: "success", ms: 40_000 }],
  };
};

test("a job is slower when its typical time grew by a quarter and by at least 30 seconds over the week before", () => {
  const jobs = [
    ...[8, 9, 10].map((daysAgo) => run(daysAgo, 68)),
    ...[1, 2, 3].map((daysAgo) => run(daysAgo, 210, "build", 96)),
    // A short job that grew by a third, but only by 7 seconds.
    ...[8, 9].map((daysAgo) => run(daysAgo, 20, "lint")),
    ...[1, 2].map((daysAgo) => run(daysAgo, 27, "lint")),
  ];
  const trends = jobTrends(jobs, NOW, 7);
  assert.deepEqual(trends.map((trend) => [trend.job, trend.typicalMs, trend.earlierTypicalMs, trend.slower]), [
    ["build", 210_000, 68_000, true],
    ["lint", 27_000, 20_000, false],
  ]);
  assert.equal(trends[0]!.change?.text, "The Install step grew from 20 seconds to 2 minutes.");
  assert.equal(trends[1]!.change, null);
  assert.equal(trends[0]!.days.length, 8);
  assert.equal(trends[0]!.days.reduce((sum, day) => sum + day.runs, 0), trends[0]!.runs);
  assert.deepEqual(trends[0]!.days.filter((day) => day.runs > 0).map((day) => day.day), ["2026-06-12", "2026-06-13", "2026-06-14"]);
});
