import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitHubJob, WorkflowRun } from "../github/github-client.ts";
import type { JobRecord } from "./job-record.ts";
import { syncJobs } from "./sync-jobs.ts";

function githubJob(id: number, runId: number, attempt: number): GitHubJob {
  return {
    id,
    run_id: runId,
    run_attempt: attempt,
    name: "test",
    conclusion: "success",
    created_at: "2026-01-02T00:00:00Z",
    started_at: "2026-01-02T00:00:01Z",
    completed_at: "2026-01-02T00:01:00Z",
    runner_name: "",
    labels: ["box"],
    head_branch: "main",
    workflow_name: "ci",
  };
}

function fakes(runs: WorkflowRun[], jobs: GitHubJob[]) {
  const records: JobRecord[] = [];
  const calls: number[] = [];
  const days: string[] = [];
  return {
    records,
    calls,
    days,
    store: {
      read: async () => [...records],
      append: async (fresh: readonly JobRecord[]) => void records.push(...fresh),
    },
    source: {
      async *runs(_repo: string, day: string) {
        days.push(day);
        if (day === "2026-01-02") yield* runs;
      },
      jobs: async (_repo: string, runId: number) => {
        calls.push(runId);
        return jobs.filter((job) => job.run_id === runId);
      },
    },
  };
}

const window = { repo: "acme/app", since: new Date("2026-01-01T12:00:00Z"), until: new Date("2026-01-03T01:00:00Z"), onRunSynced: () => {} };

test("a second sync fetches nothing new, and a rerun adds only its new jobs", async () => {
  const first = fakes([{ id: 1, run_attempt: 1 }], [githubJob(10, 1, 1)]);
  assert.equal(await syncJobs({ ...window, source: first.source, store: first.store }), 1);
  assert.equal(await syncJobs({ ...window, source: first.source, store: first.store }), 0);
  assert.deepEqual(first.calls, [1]);

  const rerun = fakes([{ id: 1, run_attempt: 2 }], [githubJob(10, 1, 1), githubJob(11, 1, 2)]);
  await rerun.store.append(first.records);
  assert.equal(await syncJobs({ ...window, source: rerun.source, store: rerun.store }), 1);
  assert.deepEqual(rerun.records.map((record) => record.jobId), [10, 11]);
});

test("a run with an unfinished job waits for a later sync", async () => {
  const unfinished = { ...githubJob(11, 1, 2), conclusion: null };
  const { source, store, records } = fakes([{ id: 1, run_attempt: 2 }], [githubJob(10, 1, 1), unfinished]);

  assert.equal(await syncJobs({ ...window, source, store }), 0);
  assert.deepEqual(records, []);
});

test("every UTC day in the window is asked for, including both ends", async () => {
  const { source, store, days } = fakes([], []);
  await syncJobs({ ...window, source, store });
  assert.deepEqual(days, ["2026-01-01", "2026-01-02", "2026-01-03"]);
});

test("an empty runner name becomes null", async () => {
  const { source, store, records } = fakes([{ id: 1, run_attempt: 1 }], [githubJob(10, 1, 1)]);
  await syncJobs({ ...window, source, store });
  assert.equal(records[0]?.runner, null);
});
