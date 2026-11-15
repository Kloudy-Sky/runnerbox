import assert from "node:assert/strict";
import { test } from "node:test";
import type { InstallState, LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { InstallContainerSample } from "runnerbox/src/tracking/sample-log.ts";
import { jobResources, type ResourceInput } from "./jobResources.ts";

const T0 = Date.parse("2026-06-10T12:00:00Z");
const SECOND = 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const RUNNER = "example-linux-1-1780000000";

const job = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  v: 1,
  repo: "owner/name",
  workflow: "ci",
  job: "test",
  jobId: 7,
  runId: 70,
  attempt: 1,
  branch: "main",
  conclusion: "success",
  runner: RUNNER,
  labels: ["self-hosted", "example-linux"],
  createdAt: iso(T0 - 5 * SECOND),
  startedAt: iso(T0),
  completedAt: iso(T0 + 60 * SECOND),
  steps: [
    { name: "Install", conclusion: "success", ms: 20 * SECOND, startedAt: iso(T0) },
    { name: "Test", conclusion: "success", ms: 40 * SECOND, startedAt: iso(T0 + 20 * SECOND) },
  ],
  ...overrides,
});

// The runner registered 10 s before its job and ended with it.
const runnerEvent = (overrides: Partial<Extract<LauncherEvent, { event: "runner" }>> = {}): LauncherEvent => ({
  install: "example",
  event: "runner",
  runnerType: "linux",
  slot: 1,
  runner: RUNNER,
  startedAt: iso(T0 - 10 * SECOND),
  durationMs: 70 * SECOND,
  exitCode: 0,
  released: false,
  limits: { memoryMiB: 4096, cpus: 2 },
  ...overrides,
});

const install = (runsIn: "container" | "job_vm" | "host" = "container"): InstallState => ({
  install: "example",
  pid: 1,
  startedAt: iso(T0 - 3600 * SECOND),
  updatedAt: iso(T0 + 120 * SECOND),
  stopping: false,
  stale: false,
  kinds: [{ name: "linux", label: "example-linux", image: null, building: null, runsIn, slots: [{ slot: 1, phase: "registered", since: iso(T0 + 70 * SECOND), runner: "example-linux-1-1780000099", detail: null }] }],
});

// One reading of slot 1's container every 15 s, from `from` to `to` seconds after T0.
const readings = (from: number, to: number, memMiB = 1000): InstallContainerSample[] =>
  Array.from({ length: Math.floor((to - from) / 15) + 1 }, (_, index) => ({
    install: "example",
    sample: { time: iso(T0 + (from + index * 15) * SECOND), containers: [{ name: "example-linux-slot1", cpuPercent: 50, memMiB }, { name: "example-linux-slot2", cpuPercent: 99, memMiB: 3000 }] },
  }));

const input = (overrides: Partial<ResourceInput> = {}): ResourceInput => ({
  now: T0 + 120 * SECOND,
  job: job(),
  verdict: null,
  events: [runnerEvent()],
  installs: [install()],
  samples: [],
  containerSamples: readings(-30, 105),
  ...overrides,
});

test("a job's readings are its own container's, inside both the job's and the container's time, with no slack", () => {
  const resources = jobResources(input());
  assert.equal(resources.coverage, "sampled");
  // Readings at -30 s and -15 s are the runner waiting for its job, and 75 s onwards is the slot's
  // next container, which has the same name.
  assert.deepEqual(resources.points.map((point) => point.offsetMs / SECOND), [0, 15, 30, 45, 60]);
  assert.ok(resources.points.every((point) => point.memMiB === 1000));
  assert.deepEqual(resources.limits, { memoryMiB: 4096, cpus: 2 });
  assert.deepEqual(resources.steps.map((step) => [step.name, step.offsetMs, step.exact]), [["Install", 0, true], ["Test", 20 * SECOND, true]]);
});

test("steps from before start times were kept are placed by adding up lengths, and marked as not exact", () => {
  const old = job({ steps: [{ name: "Install", conclusion: "success", ms: 20 * SECOND }, { name: "Test", conclusion: "success", ms: 40 * SECOND }] });
  assert.deepEqual(jobResources(input({ job: old })).steps.map((step) => [step.offsetMs, step.exact]), [[0, false], [20 * SECOND, false]]);
});

test("a container stopped for memory is placed in the step that was running", () => {
  const killed = runnerEvent({ exitCode: 137, durationMs: 45 * SECOND });
  const resources = jobResources(input({ events: [killed], job: job({ conclusion: "failure", completedAt: iso(T0 + 35 * SECOND) }) }));
  assert.deepEqual(resources.stoppedForMemory, { offsetMs: 35 * SECOND, step: "Test" });
});

test("a job still running is found through its slot in the live state", () => {
  const running = job({ runner: "example-linux-1-1780000099", startedAt: iso(T0 + 75 * SECOND), completedAt: null, steps: [] });
  const resources = jobResources(input({ job: running, events: [] }));
  assert.equal(resources.coverage, "sampled");
  assert.deepEqual(resources.points.map((point) => point.offsetMs / SECOND), [0, 15, 30]);
  assert.equal(resources.limits, null);
});

test("jobs in their own VM, on the host's OS, on other machines or with no runner say why they have no readings", () => {
  assert.equal(jobResources(input({ installs: [install("job_vm")] })).sentence?.text, "This job ran in a VM of its own, which isn't sampled yet.");
  assert.equal(jobResources(input({ installs: [install("host")] })).coverage, "host");
  assert.equal(jobResources(input({ job: job({ runner: "GitHub Actions 12" }) })).coverage, "not_ours");
  const never = jobResources(input({ job: job({ runner: null, startedAt: null, completedAt: null }) }));
  assert.equal(never.coverage, "no_runner");
  assert.equal(never.sentence, null);
});
