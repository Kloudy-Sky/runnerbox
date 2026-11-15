import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inbox, InboxItem, InstallState, JobRun, LauncherEvent } from "@runnerbox/contracts";
import { lanes, pinned } from "./now.ts";

const now = Date.parse("2026-11-15T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const evidence = { steps: [], attempts: [], machine: null, launcher: [], durations: [], reasons: [], breakdown: [] };
const jobRun = (jobId: number, conclusion: string, minutes: number): JobRun => ({
  repo: "owner/name", jobId, runId: jobId, attempt: 1, workflow: "ci", job: "test", branch: "fix", headSha: null, conclusion,
  runner: "example-linux-1-a", runnerType: "example-linux", createdAt: ago(minutes), startedAt: ago(minutes), completedAt: ago(minutes - 5), durationMs: 300_000,
  queueMs: null, verdict: null, starved: false,
});
const item = (id: string, minutes: number): InboxItem => ({
  id, kind: "failure", group: "quiet", quiet: "own_code", verdict: "code", repo: "owner/name", install: null,
  title: id, happened: "", why: "", action: "", at: ago(minutes), evidence,
});

test("needs-you items pin first, then code failures from the last hour only", () => {
  const inbox: Inbox = {
    summary: { needYou: 1, jobs: 0, passRate: null, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, headline: "", facts: [] },
    items: [{ ...item("machine", 300), group: "needs_you", quiet: null, verdict: "infra" }],
    quiet: [
      { kind: "own_code", title: "", items: [item("recent", 10), item("old", 90)] },
      { kind: "flaky", title: "", items: [item("flaky", 5)] },
    ],
  };
  assert.deepEqual(pinned(inbox, now, []).map(({ item, kind }) => `${kind}:${item.id}`), ["needs_you:machine", "code:recent"]);
  assert.deepEqual(pinned(inbox, 0, []).map(({ item }) => item.id), ["machine"], "with no report from the machine, nothing is recent");
});

test("a code failure leaves once a later run of the same job on the same branch passes", () => {
  const failing = { ...item("fixed", 10), evidence: { ...evidence, attempts: [{ jobId: 1, attempt: 1, runId: 1, headSha: null, runner: null, runnerType: "example-linux", conclusion: "failure", startedAt: null, durationMs: null }] } };
  const inbox: Inbox = {
    summary: { needYou: 0, jobs: 0, passRate: null, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, headline: "", facts: [] },
    items: [],
    quiet: [{ kind: "own_code", title: "", items: [failing] }],
  };
  assert.equal(pinned(inbox, now, [jobRun(1, "failure", 20)]).length, 1);
  assert.equal(pinned(inbox, now, [jobRun(1, "failure", 20), jobRun(2, "success", 8)]).length, 0);
  assert.equal(pinned(inbox, now, [jobRun(1, "failure", 20), { ...jobRun(2, "success", 8), branch: "main" }]).length, 1, "a pass on another branch doesn't count");
});

test("a slot's lane draws its jobs from when they started, not from when the runner waited, and what's running now", () => {
  const install: InstallState = {
    install: "example", pid: 1, startedAt: ago(120), updatedAt: ago(0), stopping: false, stale: false,
    kinds: [{ name: "linux", label: "example-linux", image: null, building: null, slots: [{ slot: 1, phase: "busy", since: ago(6), runner: "example-linux-1-b", detail: null }] }],
  };
  const event = (runner: string, startedMinutes: number, minutes: number, released: false | "memory" = false): LauncherEvent => ({
    install: "example", runnerType: "linux", event: "runner", slot: 1, runner, exitCode: 0, released, startedAt: ago(startedMinutes), durationMs: minutes * 60_000,
  });
  const run: JobRun = {
    repo: "owner/name", jobId: 1, runId: 1, attempt: 1, workflow: "ci", job: "test", branch: "main", headSha: null, conclusion: "failure",
    runner: "example-linux-1-a", runnerType: "example-linux", createdAt: ago(31), startedAt: ago(30), completedAt: ago(18), durationMs: 12 * 60_000,
    queueMs: null, verdict: null, starved: false,
  };
  const [lane] = lanes([install], [event("example-linux-1-a", 40, 22), event("example-linux-1-x", 20, 10, "memory")], [run], now);
  assert.deepEqual(lane?.blocks, [
    { start: 0.5, end: 0.7, outcome: "failed" },
    { start: 0.9, end: 1, outcome: "running" },
  ]);
});
