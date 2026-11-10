import assert from "node:assert/strict";
import { test } from "node:test";
import { type } from "arktype";
import type { GitHubJob } from "../github/github-client.ts";
import { distinctJobs, elapsedMs, JobRecord, toJobRecord } from "./job-record.ts";

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

test("a job records the commit it ran on, and a line from before that still reads", () => {
  const job: GitHubJob = {
    id: 9, run_id: 4, run_attempt: 1, name: "test", workflow_name: "ci", head_branch: "main", head_sha: "3b8ac79e0f1d2c3b4a5968778695a4b3c2d1e0f9",
    conclusion: "success", runner_name: "box-1", labels: ["box"], created_at: base.createdAt, started_at: base.startedAt, completed_at: base.completedAt,
  };
  assert.equal(toJobRecord("acme/app", job).headSha, "3b8ac79e0f1d2c3b4a5968778695a4b3c2d1e0f9");
  assert.ok(!(JobRecord(JSON.parse(JSON.stringify(base))) instanceof type.errors));
});
