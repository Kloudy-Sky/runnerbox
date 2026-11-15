import assert from "node:assert/strict";
import { test } from "node:test";
import type { InstallState, LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { explainInstall } from "./explain.ts";
import type { ExplainInput } from "./input.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

type Slot = InstallState["kinds"][number]["slots"][number];
const slot = (n: number, phase: Slot["phase"], extra: Partial<Slot> = {}): Slot => ({ slot: n, phase, since: iso(NOW - 2 * MINUTE), runner: null, detail: null, job: null, ...extra });

// linux has 2 runners, docker 1 and light 3, all in containers in the VM, as `up` reports them.
const install = (slots: { linux?: Slot[]; docker?: Slot[]; light?: Slot[] } = {}, extra: Partial<InstallState> = {}): InstallState => ({
  install: "example",
  pid: 1,
  startedAt: iso(NOW - 24 * 60 * MINUTE),
  updatedAt: iso(NOW),
  stopping: false,
  stale: false,
  memoryFloor: { hostMiB: 1024, vmMiB: 2048 },
  kinds: (["linux", "docker", "light"] as const).map((name) => ({
    name,
    label: `example-${name}`,
    image: `${name}:1`,
    building: null,
    runsIn: "container" as const,
    ...(name === "light" ? { memoryFloor: { hostMiB: 512, vmMiB: 1024 } } : {}),
    slots: slots[name] ?? Array.from({ length: { linux: 2, docker: 1, light: 3 }[name] }, (_, index) => slot(index + 1, "registered")),
  })),
  ...extra,
});

const runner = (kind: string, n: number, startedAt: number, durationMs: number, extra: Partial<Extract<LauncherEvent, { event: "runner" }>> = {}): LauncherEvent => ({
  install: "example",
  event: "runner",
  runnerType: kind,
  slot: n,
  runner: `example-${kind}-${n}-${startedAt / 1000}`,
  startedAt: iso(startedAt),
  durationMs,
  exitCode: 0,
  released: false,
  ...extra,
});
const memoryWait = (kind: string, n: number, startedAt: number, durationMs: number): LauncherEvent => ({ install: "example", event: "memory_wait", runnerType: kind, slot: n, startedAt: iso(startedAt), durationMs });

let nextId = 1;
// The job a runner event ran, as `report` records it.
const jobOn = (event: LauncherEvent, ms: number, conclusion = "success", name = "test"): JobRecord => {
  const start = Date.parse(event.startedAt) + 10_000;
  const id = nextId++;
  return {
    v: 1,
    repo: "owner/name",
    workflow: "ci",
    job: name,
    jobId: id,
    runId: id,
    attempt: 1,
    branch: "main",
    conclusion,
    labels: ["self-hosted"],
    runner: event.event === "runner" ? event.runner : null,
    createdAt: iso(start),
    startedAt: iso(start),
    completedAt: iso(start + ms),
    steps: [],
  };
};

const explain = (input: Partial<ExplainInput> = {}) =>
  explainInstall({ now: NOW, install: install(), events: [], jobs: [], samples: [], containerSamples: [], ...input });

const busy = [slot(1, "busy", { job: "ci / test" }), slot(2, "busy", { job: "ci / build" })];

test("a machine with no runner free anywhere says there's no room, and which labels' jobs will wait", () => {
  const aside = [slot(1, "waiting", { detail: "The VM has 0.8 GB free. Runnerbox keeps 2.0 GB free before it starts another runner." })];
  const result = explain({ install: install({ linux: busy, docker: aside, light: [slot(1, "waiting"), slot(2, "waiting"), slot(3, "waiting")] }) });
  assert.equal(result.headline, "2 jobs running. No room for another until one finishes. New jobs for example-linux, example-docker and example-light will wait.");
  assert.equal(result.runners.find((tile) => tile.kind === "docker")?.why, "The VM has 0.8 GB free. Runnerbox keeps 2.0 GB free before it starts another runner.");
});

test("with some kinds full and another ready, it names which wait and which can still take jobs, not that there's no room", () => {
  const result = explain({ install: install({ linux: busy, docker: [slot(1, "waiting")] }) });
  assert.equal(result.headline, "2 jobs running. New jobs for example-linux and example-docker will wait. light can still take jobs.");
});

test("a quiet machine says how many runners are ready, and never that a label's jobs will wait", () => {
  const result = explain();
  assert.equal(result.headline, "Nothing running. 6 runners ready.");
});

test("an older up, which can't tell ready from busy, claims neither", () => {
  const unsure = install();
  const old = { ...unsure, kinds: unsure.kinds.map((kind) => ({ ...kind, slots: kind.slots.map(({ job: _job, ...rest }) => rest) })) };
  const result = explain({ install: old });
  assert.equal(result.headline, "");
  assert.ok(result.runners.every((tile) => tile.state === "maybe_running"));
});

test("eleven times stepping aside in twenty minutes is one episode, and a later one is another", () => {
  const start = NOW - 60 * MINUTE;
  const events = [
    ...Array.from({ length: 8 }, (_, index) => memoryWait(index % 2 ? "light" : "docker", 1, start + index * 2 * MINUTE, MINUTE)),
    ...Array.from({ length: 3 }, (_, index) => runner("light", index + 1, start + 17 * MINUTE + index * 1000, 2 * MINUTE, { released: "memory" })),
    memoryWait("docker", 1, NOW - 10 * MINUTE, 30_000),
  ];
  const aside = explain({ events }).episodes.filter((episode) => episode.kind === "stepped_aside");
  assert.deepEqual(aside.map((episode) => episode.sentence), [
    "docker runners stepped aside once so running jobs had enough memory. Each time it was under a minute.",
    "For 19 minutes, docker and light runners stepped aside 8 times so running jobs had enough memory. Each time, a runner waited about a minute.",
  ]);
  assert.equal(aside[1]?.rows.length, 11);
});

test("the jobs a kind ran are one sentence: how many, whether they passed, and the longest", () => {
  const events = Array.from({ length: 9 }, (_, index) => runner("linux", (index % 2) + 1, NOW - 50 * MINUTE + index * 4 * MINUTE, 3 * MINUTE));
  const passed = explain({ events, jobs: events.map((event, index) => jobOn(event, index === 4 ? 8 * MINUTE + 47_000 : 2 * MINUTE)) });
  assert.equal(passed.episodes[0]?.sentence, "linux ran 9 jobs and all passed. The longest took 8m 47s.");
  assert.equal(passed.episodes[0]?.bad, false);

  const mixed = explain({ events, jobs: events.map((event, index) => jobOn(event, 2 * MINUTE, index < 2 ? "failure" : "success")) });
  assert.equal(mixed.episodes[0]?.sentence, "linux ran 9 jobs: 7 passed, 2 failed. The longest took 2m 00s.");
  assert.equal(mixed.episodes[0]?.bad, true);

  // Without the job log, it says only what the runners show.
  assert.equal(explain({ events }).episodes[0]?.sentence, "linux runners took 9 jobs. GitHub's results for them aren't synced here.");
});

test("a kind whose runners keep failing says so up top, and its episode gives the plain reason", () => {
  const events = Array.from({ length: 4 }, (_, index) => runner("docker", 1, NOW - 10 * MINUTE + index * 2 * MINUTE, 3000, { exitCode: 125 }));
  const retrying = [slot(1, "backoff", { detail: "the last runner exited 125 within a minute" })];
  const result = explain({ install: install({ docker: retrying }), events });
  assert.match(result.headline, /The docker runners keep failing before they take a job, so Runnerbox waits before each try\./);
  const tile = result.runners.find((each) => each.kind === "docker");
  assert.equal(tile?.state, "retrying");
  assert.equal(tile?.why, "Its last runner stopped within a minute of starting.");
  assert.equal(result.episodes[0]?.sentence, "docker runners stopped 4 times before taking a job. Runnerbox waits before each try. Docker couldn't start the container. That usually means the image, or the runtime it needs, is missing or broken.");
  assert.ok(!result.episodes[0]?.sentence.includes("125"), "exit codes stay in the raw rows");
});

test("the pause after every runner reads as starting, not as trouble", () => {
  const result = explain({ install: install({ docker: [slot(1, "backoff", { detail: "Starting the next runner." })] }) });
  assert.deepEqual(result.runners.find((tile) => tile.kind === "docker")?.state, "starting");
});

test("an image being rebuilt is said up top", () => {
  const rebuilding = install();
  const result = explain({ install: { ...rebuilding, kinds: rebuilding.kinds.map((kind) => (kind.name === "light" ? { ...kind, building: "light:2" } : kind)) } });
  assert.equal(result.headline, "Nothing running. The light image is rebuilding.");
});

test("a job name from the runner's output is one short line of plain text", () => {
  const result = explain({ install: install({ linux: [slot(1, "busy", { job: `ci / test\n\u001b[31m${"x".repeat(100)}` }), slot(2, "registered")] }) });
  const name = result.runners[0]?.job ?? "";
  assert.ok(name.length <= 60 && !/[\n\u001b]/.test(name));
});

test("the memory picture follows where jobs run, and says when there's no reading", () => {
  const vm = { totalMiB: 16_384, availableMiB: 2_800, swapUsedMiB: 0, load1: 1 };
  const samples = [{ install: "example", sample: { time: iso(NOW - MINUTE), host: { ...vm, availableMiB: 9_000 }, vm } }];
  const busy = install({ linux: [slot(1, "busy", { job: "ci / test" }), slot(2, "registered")] });
  const containerSamples = [{ install: "example", sample: { time: iso(NOW - 10_000), containers: [{ name: "example-linux-slot1", cpuPercent: 90, memMiB: 3_000 }] } }];

  const containers = explain({ install: busy, samples, containerSamples }).memory;
  assert.equal(containers._tag, "reading");
  if (containers._tag === "reading") {
    assert.deepEqual([containers.machine, containers.floorMiB, containers.jobs.map((job) => job.memMiB)], ["VM", 2048, [3_000]]);
    assert.deepEqual(containers.kindFloors, [{ kind: "light", floorMiB: 1024 }], "a kind with its own floor is named");
  }

  const jobVms = { ...busy, kinds: busy.kinds.map((kind) => ({ ...kind, runsIn: "job_vm" as const })) };
  const host = explainInstall({ now: NOW, install: jobVms, events: [], jobs: [], samples, containerSamples });
  assert.ok(host.memory._tag === "reading" && host.memory.machine === "host" && host.memory.floorMiB === 1024 && host.memory.unmeasured !== null);

  const onHost = { ...busy, kinds: busy.kinds.map((kind) => ({ ...kind, runsIn: "host" as const })) };
  assert.deepEqual(explain({ install: onHost, samples }).memory, { _tag: "none", why: "Jobs here run on the machine itself, and Runnerbox doesn't measure its memory yet." });

  assert.deepEqual(explain({ install: busy }).memory, { _tag: "none", why: "No memory reading in the last 3 minutes." });
});
