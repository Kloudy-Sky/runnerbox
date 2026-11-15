import assert from "node:assert/strict";
import { test } from "node:test";
import type { InstallState, LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { InboxInput } from "../inbox/rules.ts";
import { kindUsage } from "./kindUsage.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const MINUTE = 60_000;
const BURST = NOW - 60 * MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();

const install: InstallState = {
  install: "example", pid: 1, startedAt: iso(NOW - 24 * 60 * MINUTE), updatedAt: iso(NOW), stopping: false, stale: false,
  kinds: [{ name: "linux", label: "example-linux", image: null, building: null, runsIn: "container", slots: [1, 2].map((slot) => ({ slot, phase: "registered" as const, since: iso(NOW), runner: null, detail: null })) }],
};

let id = 1;
const job = (createdAt: number, start: number | null, ms: number): JobRecord => {
  const runner = start === null ? null : `example-linux-1-${id}`;
  return {
    v: 1, repo: "owner/name", workflow: "ci", job: "test", jobId: id++, runId: id, attempt: 1, branch: "main",
    conclusion: start === null ? "cancelled" : "success", runner, labels: ["self-hosted", "example-linux"],
    createdAt: iso(createdAt), startedAt: iso(start ?? createdAt + ms), completedAt: iso((start ?? createdAt) + ms), steps: [],
  };
};
const ranBy = (jobs: readonly JobRecord[]): LauncherEvent[] =>
  jobs.flatMap((each) => (each.runner === null ? [] : [{ install: "example", event: "runner" as const, runnerType: "linux", slot: 1, runner: each.runner, startedAt: each.startedAt!, durationMs: 10 * MINUTE, exitCode: 0, released: false as const, limits: { memoryMiB: 4096, cpus: 4 } }]));
const usage = (jobs: JobRecord[]) => kindUsage({ now: NOW, jobs, machine: () => undefined, events: ranBy(jobs), installs: [install] } satisfies InboxInput, 1).kinds[0]!;

test("a burst on too few slots is named as the bottleneck by the inbox's own rule", () => {
  // The owner's case: 10 jobs at once on 2 slots, run two at a time for 10 minutes each, and the
  // last 4 cancelled after waiting 25 minutes.
  const jobs = [...[0, 0, 10, 10, 20, 20].map((offset) => job(BURST, BURST + offset * MINUTE + 10_000, 10 * MINUTE)), ...[1, 2, 3, 4].map(() => job(BURST, null, 25 * MINUTE))];
  const kind = usage(jobs);
  assert.equal(kind.slots, 2);
  assert.deepEqual(kind.bottleneck, { cause: "slots", text: "The linux runners are the bottleneck: both of their slots were busy while jobs waited, with 10 jobs waiting at once." });
  assert.equal(kind.waitLongestMs, 25 * MINUTE);
  // 30 minutes with both slots taken, out of the day.
  assert.equal(Math.round(kind.allBusyShare! * 24 * 60), 30);
  assert.deepEqual(kind.cost, { usd: 0.72, minutes: 60, size: "4-core Linux", usdPerMinute: 0.012 });
});

test("a quiet day names no bottleneck", () => {
  const kind = usage([job(BURST, BURST + 10_000, 10 * MINUTE), job(BURST + 30 * MINUTE, BURST + 30 * MINUTE + 10_000, 10 * MINUTE)]);
  assert.equal(kind.bottleneck, null);
  assert.equal(kind.waitTypicalMs, 10_000);
});
