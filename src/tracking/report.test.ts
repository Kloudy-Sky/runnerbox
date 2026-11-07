import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRecord } from "./job-record.ts";
import { compareSteps, percentile, summarizeJobs } from "./report.ts";

let nextJobId = 1;

function record(overrides: Partial<JobRecord> & { seconds?: number } = {}): JobRecord {
  const { seconds = 60, ...fields } = overrides;
  return {
    v: 1,
    repo: "acme/app",
    workflow: "ci",
    job: "test",
    jobId: nextJobId++,
    runId: nextJobId,
    attempt: 1,
    branch: "main",
    conclusion: "success",
    runner: "box-1",
    labels: ["self-hosted", "box"],
    createdAt: "2026-01-01T00:00:00Z",
    startedAt: "2026-01-01T00:00:10Z",
    completedAt: new Date(Date.parse("2026-01-01T00:00:10Z") + seconds * 1000).toISOString(),
    steps: [],
    ...fields,
  };
}

test("percentile returns a real value by nearest rank", () => {
  assert.equal(percentile([30, 10, 20], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 90), 40);
  assert.equal(percentile([], 50), null);
});

test("a job that never got a runner counts as no runner, not as time spent", () => {
  const [summary] = summarizeJobs([
    record({ seconds: 60 }),
    record({ seconds: 240, runner: null, conclusion: "cancelled" }),
    record({ seconds: 8, runner: null, conclusion: "failure" }),
  ]);

  assert.deepEqual(
    { ran: summary?.ran, failed: summary?.failed, noRunner: summary?.noRunner, totalMs: summary?.totalMs, p90Ms: summary?.p90Ms },
    { ran: 1, failed: 0, noRunner: 2, totalMs: 60_000, p90Ms: 60_000 },
  );
});

test("skipped jobs are left out entirely", () => {
  const summaries = summarizeJobs([
    record({ conclusion: "success" }),
    record({ runner: null, conclusion: "skipped" }),
    record({ job: "deploy", runner: null, conclusion: "skipped", labels: [] }),
  ]);

  assert.deepEqual(summaries.map((row) => [row.job, row.ran, row.noRunner]), [["test", 1, 0]]);
});

test("runner types stay separate and ignore the self-hosted label", () => {
  const summaries = summarizeJobs([
    record({ labels: ["self-hosted", "box"], seconds: 480 }),
    record({ labels: ["hosted-4cpu"], seconds: 60 }),
  ]);

  assert.deepEqual(
    summaries.map((row) => [row.runnerType, row.p50Ms]),
    [["box", 480_000], ["hosted-4cpu", 60_000]],
  );
});

test("a failure counts as passed on retry only if a later attempt of that run passed", () => {
  const [summary] = summarizeJobs([
    record({ runId: 1, attempt: 1, conclusion: "failure" }),
    record({ runId: 1, attempt: 2, conclusion: "success" }),
    record({ runId: 2, attempt: 1, conclusion: "failure" }),
    record({ runId: 2, attempt: 2, conclusion: "failure" }),
  ]);

  assert.equal(summary?.failed, 3);
  assert.equal(summary?.passedOnRetry, 1);
});

test("compareSteps shows each step's median per runner type from passing runs only", () => {
  const step = (ms: number) => [{ name: "unit tests", conclusion: "success", ms }];
  const { runnerTypes, steps } = compareSteps(
    [
      record({ labels: ["box"], steps: step(400_000) }),
      record({ labels: ["box"], steps: step(999_000), conclusion: "failure" }),
      record({ labels: ["hosted"], steps: step(50_000) }),
      record({ job: "other", labels: ["box"], steps: step(1) }),
    ],
    "test",
  );

  assert.deepEqual(runnerTypes, ["box", "hosted"]);
  assert.deepEqual([...steps[0]!.p50MsByRunnerType], [["box", 400_000], ["hosted", 50_000]]);
});
