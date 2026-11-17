import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueView, WaitingJob } from "@runnerbox/contracts";
import { waitingEverywhere } from "./waitingEverywhere.ts";

const job = (name: string, since: string): WaitingJob => ({ repo: "owner/name", workflow: "ci", job: name, label: "example-linux", since, url: `https://github.com/owner/name/actions/runs/1/job/${name}` });
const queue = (waiting: WaitingJob[]): QueueView => ({ status: "watching", reason: null, waiting, resumesAt: null, reposLeftOut: 0, runsLeftOut: 0, checkedAt: null });

test("a job two machines both see waits once, naming both, and the longest waiting comes first", () => {
  const shared = job("e2e", "2026-11-15T12:05:00Z");
  const waiting = waitingEverywhere([
    { key: "a", machine: "linux-box", queue: queue([shared]) },
    { key: "b", machine: "laptop", queue: queue([job("lint", "2026-11-15T12:00:00Z"), shared]) },
  ]);
  assert.deepEqual(
    waiting.map(({ job, machines }) => [job.job, machines]),
    [
      ["lint", ["laptop"]],
      ["e2e", ["linux-box", "laptop"]],
    ],
  );
});
