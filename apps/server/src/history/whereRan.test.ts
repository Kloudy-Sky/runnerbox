import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { whereRan } from "./whereRan.ts";

let id = 1;
const job = (repo: string, labels: string[], over: Partial<JobRecord> = {}): JobRecord => ({
  v: 1, repo, workflow: "ci", job: "test", jobId: id++, runId: id, attempt: 1, branch: "main", conclusion: "success", runner: `runner-${id}`, labels,
  createdAt: "2026-06-10T12:00:00Z", startedAt: "2026-06-10T12:00:05Z", completedAt: "2026-06-10T12:05:00Z", steps: [], ...over,
});

test("each repository's jobs are counted here when they asked for self-hosted, and on GitHub otherwise", () => {
  const jobs = [
    job("owner/name", ["self-hosted", "example-linux"]),
    job("owner/name", ["self-hosted", "example-docker"]),
    job("owner/name", ["ubuntu-24.04"]),
    job("owner/other", ["ubuntu-latest"]),
  ];
  assert.deepEqual(whereRan(jobs), [
    { repo: "owner/name", here: 2, github: 1 },
    { repo: "owner/other", here: 0, github: 1 },
  ]);
});

test("a job that never got a runner, or was skipped, didn't run anywhere", () => {
  const jobs = [job("owner/name", ["self-hosted", "example-linux"], { runner: null, conclusion: "cancelled" }), job("owner/name", ["ubuntu-latest"], { conclusion: "skipped" })];
  assert.deepEqual(whereRan(jobs), []);
});
