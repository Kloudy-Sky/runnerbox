import assert from "node:assert/strict";
import { test } from "node:test";
import { distinctJobs, elapsedMs, type JobRecord } from "./job-record.ts";

const base: JobRecord = {
  v: 1,
  repo: "acme/app",
  workflow: "ci",
  job: "test",
  jobId: 1,
  runId: 1,
  attempt: 1,
  branch: "main",
  conclusion: "success",
  runner: "box-1",
  labels: ["box"],
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: "2026-01-01T00:00:10Z",
  completedAt: "2026-01-01T00:01:00Z",
  steps: [],
};

test("a rerun's copy of a passed job is dropped, but a real rerun is kept", () => {
  const copy = { ...base, jobId: 2, attempt: 2 };
  const realRerun = { ...base, jobId: 3, attempt: 3, startedAt: "2026-01-01T01:00:00Z" };

  assert.deepEqual(distinctJobs([base, copy, realRerun]).map((record) => record.jobId), [1, 3]);
});

test("jobs with no runner are only the same job if their IDs match", () => {
  const noRunner = { ...base, runner: null };

  assert.deepEqual(
    distinctJobs([noRunner, { ...noRunner }, { ...noRunner, jobId: 2 }]).map((record) => record.jobId),
    [1, 2],
  );
});

test("an end before the start isn't a duration", () => {
  assert.equal(elapsedMs("2026-01-01T00:01:00Z", "2026-01-01T00:00:00Z"), null);
  assert.equal(elapsedMs("2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z"), 60_000);
});
