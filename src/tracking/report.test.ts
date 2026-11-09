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

test("a timeout counts as a failure, and same-named jobs in other workflows stay separate", () => {
  const summaries = summarizeJobs([
    record({ workflow: "ci", runId: 1, attempt: 1, conclusion: "timed_out" }),
    record({ workflow: "ci", runId: 1, attempt: 2, conclusion: "success" }),
    record({ workflow: "nightly", conclusion: "success" }),
  ]);

  assert.deepEqual(
    summaries.map((row) => [row.workflow, row.failed, row.passedOnRetry]),
    [["ci", 1, 1], ["nightly", 0, 0]],
  );
});

test("compareSteps ignores skipped steps", () => {
  const { steps } = compareSteps(
    [
      record({ steps: [{ name: "deploy", conclusion: "skipped", ms: 0 }] }),
      record({ steps: [{ name: "deploy", conclusion: "success", ms: 300_000 }] }),
    ],
    "test",
  );

  assert.equal(steps[0]?.p50MsByRunnerType.get("box"), 300_000);
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

test("grouping by runner tells two launchers on one label apart", () => {
  const summaries = summarizeJobs(
    [
      record({ runner: "old-box-1" }),
      record({ runner: "old-box-3" }),
      record({ runner: "rb-linux-2-1794160988" }),
    ],
    { by: "runner" },
  );
  assert.deepEqual(summaries.map((row) => [row.runnerType, row.ran]).sort(), [["old-box", 2], ["rb-linux", 1]]);
});

test("machine columns come from the samples joined to each job", () => {
  const machine = (job: JobRecord) => (job.runner === "box-1" ? { samples: 2, vmLowMiB: 800, vmSwapPeakMiB: 300 } : undefined);
  const [summary] = summarizeJobs([record(), record({ runner: "box-2" })], { machine });
  assert.equal(summary?.vmLowP50MiB, 800);
  assert.equal(summary?.vmSwapP90MiB, 300);
  assert.equal(summary?.hostLowP50MiB, null);
});

test("runnerbox kinds named with digits stay apart when grouped by runner", () => {
  const summaries = summarizeJobs(
    [record({ runner: "rb-22-1-1794160988" }), record({ runner: "rb-24-1-1794160988" }), record({ runner: "box-2" })],
    { by: "runner" },
  );
  assert.deepEqual(summaries.map((row) => row.runnerType).sort(), ["box", "rb-22", "rb-24"]);
});
