import assert from "node:assert/strict";
import { test } from "node:test";
import type { InstallState, LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { deriveInbox } from "./derive.ts";
import type { InboxInput } from "./rules.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
// A burst of jobs arrives an hour ago.
const BURST = NOW - 60 * MINUTE;
const LABELS = { linux: "example-linux", light: "example-light", docker: "example-docker" } as const;
type Kind = keyof typeof LABELS;

// One install with three kinds, as `up` reports it: linux has 2 slots, light 4, docker 2.
const install = (slots: Partial<Record<Kind, number>> = {}): InstallState => ({
  install: "example",
  pid: 1,
  startedAt: iso(NOW - 24 * 60 * MINUTE),
  updatedAt: iso(NOW),
  stopping: false,
  stale: false,
  kinds: (["linux", "light", "docker"] as const).map((name) => ({
    name,
    label: LABELS[name],
    image: null,
    building: null,
    slots: Array.from({ length: slots[name] ?? { linux: 2, light: 4, docker: 2 }[name] }, (_, index) => ({ slot: index + 1, phase: "registered" as const, since: iso(NOW), runner: null, detail: null })),
  })),
});

let nextId = 1;
const job = (createdAt: number, overrides: Partial<JobRecord> = {}): JobRecord => ({
  v: 1,
  repo: "owner/name",
  workflow: "ci",
  job: "test",
  jobId: nextId++,
  runId: nextId,
  attempt: 1,
  branch: "main",
  conclusion: "success",
  runner: null,
  labels: ["self-hosted", LABELS.linux],
  createdAt: iso(createdAt),
  startedAt: null,
  completedAt: null,
  steps: [],
  ...overrides,
});
// Ran on a linux slot from `start` for `ms`.
const ran = (createdAt: number, start: number, ms = 10 * MINUTE) =>
  job(createdAt, { runner: `example-linux-1-${start}`, startedAt: iso(start), completedAt: iso(start + ms) });
// Waited from `createdAt` for `ms` and was cancelled without a runner.
const starved = (createdAt: number, ms: number) => job(createdAt, { conclusion: "cancelled", startedAt: iso(createdAt + ms), completedAt: iso(createdAt + ms) });

// The owner's case: 10 linux jobs arrive together. The 2 slots run them 10 minutes each, two at a
// time, and the last 2 are cancelled after waiting 25 minutes.
const burst = () => [
  ...[0, 0, 10, 10].map((offset) => ran(BURST, BURST + offset * MINUTE + 10_000)),
  ...[20, 20].map((offset) => ran(BURST, BURST + offset * MINUTE + 10_000)),
  ...[0, 0, 0, 0].map(() => starved(BURST, 25 * MINUTE)),
];
const memoryWait = (runnerType: Kind, start: number, ms: number): LauncherEvent => ({ install: "example", event: "memory_wait", runnerType, slot: 1, startedAt: iso(start), durationMs: ms });

const waitItem = (overrides: Partial<InboxInput>) =>
  deriveInbox({ now: NOW, jobs: [], machine: () => undefined, events: [], installs: [install()], ...overrides }).find((item) => item.kind === "no_runner" && item.group === "needs_you")!;

test("memory waits on another kind are not blamed, and a full kind is named as having too few slots", () => {
  // Long memory waits on docker and light, whose labels these jobs can't use.
  const events = [memoryWait("docker", BURST, 40 * MINUTE), memoryWait("light", BURST + 5 * MINUTE, 20 * MINUTE)];
  const item = waitItem({ jobs: burst(), events });
  assert.equal(
    item.why,
    "There are 2 runners for these jobs on example, and both were busy the whole time. 10 jobs were waiting at once. A typical job takes 10 minutes, so 2 runners need about 50 minutes to get through 10.",
  );
  assert.equal(item.action, "Add a runner on example.");
  assert.deepEqual(item.evidence.launcher, []);
});

test("more slots are said to need more memory only when the samples show it ran low", () => {
  const machine = (candidate: JobRecord) => (candidate.runner ? { samples: 10, vmLowMiB: 600, vmTotalMiB: 16_384 } : undefined);
  const item = waitItem({ jobs: burst(), machine });
  assert.match(item.why, /^There are 2 runners for these jobs on example/);
  assert.equal(item.action, "Give the runners on example more memory, then add a runner. They ran low on memory while these jobs ran.");
  // Low on the host only: the runners' share can't grow, so the machine needs memory freed.
  const host = waitItem({ jobs: burst(), machine: (candidate) => (candidate.runner ? { samples: 10, hostLowMiB: 2_000, hostTotalMiB: 65_536 } : undefined) });
  assert.match(host.action, /^Free up memory on example, then add a runner\./);
  assert.ok(host.evidence.reasons.includes("the host ran low on memory while example-linux jobs ran"));
});

test("a memory wait from an up that tagged no kinds counts on an install that only ever had one kind", () => {
  const untagged: LauncherEvent = { install: "example", event: "memory_wait", slot: 1, startedAt: iso(BURST - 5 * MINUTE), durationMs: 30 * MINUTE };
  const one = { ...install(), kinds: install().kinds.filter((kind) => kind.name === "linux") };
  assert.match(waitItem({ jobs: [starved(BURST, 25 * MINUTE)], events: [untagged], installs: [one] }).why, /^Free memory on example was too low to start another runner/);
  // With three kinds there's no telling whose wait it was, so it isn't blamed.
  assert.match(waitItem({ jobs: [starved(BURST, 25 * MINUTE)], events: [untagged] }).why, /^The logs don't show why/);
});

test("memory waits seconds long are not blamed for jobs that waited many minutes", () => {
  // Only one slot ran jobs, so the kind wasn't full either.
  const jobs = [ran(BURST, BURST + 10_000, 30 * MINUTE), ...[0, 0].map(() => starved(BURST, 25 * MINUTE))];
  const events = [memoryWait("linux", BURST + 2 * MINUTE, 8_000), memoryWait("linux", BURST + 9 * MINUTE, 6_000)];
  const item = waitItem({ jobs, events });
  assert.equal(
    item.why,
    "The logs don't show why. There are 2 runners for these jobs on example, and they were never all busy at once. Free memory ran short for 14 seconds of the 25 minutes these jobs were waiting, too little to explain it.",
  );
  assert.equal(item.action, "Check that Runnerbox is running on example.");
  assert.equal(item.evidence.launcher.length, 2);
});

test("memory waits on the jobs' own kind that cover their wait are the reason", () => {
  const item = waitItem({ jobs: [starved(BURST, 25 * MINUTE)], events: [memoryWait("linux", BURST - 5 * MINUTE, 30 * MINUTE)] });
  assert.equal(item.why, "Free memory on example was too low to start another runner for the whole time these jobs waited.");
  assert.equal(item.action, "Give the runners on example more memory, so more of them can start at once.");
});

test("with neither reason, it says what is known and guesses no cause", () => {
  const item = waitItem({ jobs: [starved(BURST, 25 * MINUTE)] });
  assert.equal(item.why, "The logs don't show why. There are 2 runners for these jobs on example, and they were never all busy at once. Free memory never ran short.");
  // No live state and no runner recorded for the label: which kinds serve it isn't known.
  const unserved = deriveInbox({
    now: NOW,
    jobs: [ran(BURST - 120 * MINUTE, BURST - 120 * MINUTE), starved(BURST, 25 * MINUTE)],
    machine: () => undefined,
    events: [{ install: "example", event: "runner", slot: 1, runner: `example-linux-1-${BURST - 120 * MINUTE}`, startedAt: iso(BURST - 120 * MINUTE), durationMs: MINUTE, exitCode: 0, released: false }],
    installs: [],
  }).find((each) => each.kind === "no_runner")!;
  assert.equal(unserved.why, "The logs don't show which of your runners take these jobs, so they can't say why they waited.");
});
