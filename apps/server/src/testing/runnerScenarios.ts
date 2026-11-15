import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSlotState } from "runnerbox/src/launcher/slot-state.ts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { LauncherEvent } from "runnerbox/src/tracking/launcher-event.ts";
import type { ContainerSample, Sample } from "runnerbox/src/tracking/sample-record.ts";

// Machines for the Runners page, one per case it has to read well in. Each replaces the fixture
// install's live state, events and samples, and adds a job log for its runners. Names are generic.
export const RUNNER_SCENARIOS = ["busy", "quiet", "failing", "rebuilding", "no-samples"] as const;
export type RunnerScenario = (typeof RUNNER_SCENARIOS)[number];

const MINUTE = 60_000;
const INSTALL = "example";
const REPO = "owner/runners";
const TOTAL_MIB = 16_384;
const FLOOR = { hostMiB: 1024, vmMiB: 2048 };
const KINDS = [
  { name: "linux", label: "example-linux", slots: 2, image: { rebuildDays: 7 }, runsIn: "container" as const },
  { name: "docker", label: "example-linux-docker", slots: 1, runsIn: "container" as const },
  { name: "light", label: "example-linux-light", slots: 3, runsIn: "container" as const, memoryFloor: { hostMiB: 512, vmMiB: 1024 } },
];

type Line = LauncherEvent & { time: string };

export async function writeRunnerScenario(dir: string, now: number, scenario: RunnerScenario) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const events: Line[] = [];
  const jobs: JobRecord[] = [];
  let jobId = 50_000;

  // A runner that took a job, and the job the log has for it.
  const ran = (kind: string, slot: number, start: number, jobMs: number, name: string, conclusion = "success") => {
    const runner = `${INSTALL}-${kind}-${slot}-${Math.floor(start / 1000)}`;
    const jobStart = start + 20_000;
    events.push({ time: iso(jobStart + jobMs), event: "runner", runnerType: kind, slot, runner, startedAt: iso(start), durationMs: jobMs + 25_000, exitCode: 0, released: false, limits: { memoryMiB: 6144, cpus: 4 } });
    jobId += 1;
    jobs.push({ v: 1, repo: REPO, workflow: "ci", job: name, jobId, runId: jobId, attempt: 1, branch: "main", conclusion, runner, labels: ["self-hosted", `example-${kind}`], createdAt: iso(jobStart - 5_000), startedAt: iso(jobStart), completedAt: iso(jobStart + jobMs), steps: [] });
  };
  const stepAside = (kind: string, slot: number, start: number, ms: number, released: boolean) => {
    if (released) events.push({ time: iso(start), event: "runner", runnerType: kind, slot, runner: `${INSTALL}-${kind}-${slot}-${Math.floor((start - 4 * MINUTE) / 1000)}`, startedAt: iso(start - 4 * MINUTE), durationMs: 4 * MINUTE, exitCode: 0, released: "memory" });
    events.push({ time: iso(start + ms), event: "memory_wait", runnerType: kind, slot, startedAt: iso(start), durationMs: ms });
  };

  // linux kept busy over the last hour, all passing.
  const linuxHour = () => {
    const lengths = [4 * MINUTE, 5 * MINUTE, 3 * MINUTE, 8 * MINUTE + 47_000, 4 * MINUTE, 6 * MINUTE, 2 * MINUTE, 5 * MINUTE, 3 * MINUTE];
    lengths.forEach((ms, index) => ran("linux", (index % 2) + 1, now - 58 * MINUTE + index * 5 * MINUTE, ms, index % 2 ? "ci / build" : "ci / test"));
  };

  const live = createSlotState(join(dir, INSTALL, "state.json"), INSTALL, KINDS, () => now, FLOOR);
  for (const kind of ["linux", "docker", "light"]) live.image(kind, `app-${kind}:3f9a1c2b7d4e`, null);
  const ready = (kind: string, slots: number[]) => slots.forEach((slot) => live.slot(kind, slot, "registered", { runner: `${INSTALL}-${kind}-${slot}-${Math.floor(now / 1000) - 600}` }));
  let availableNow = 11_000;
  let containers: { name: string; cpuPercent: number; memMiB: number }[] = [];

  if (scenario === "busy" || scenario === "no-samples") {
    linuxHour();
    for (let index = 0; index < 3; index += 1) ran("light", index + 1, now - 47 * MINUTE, 16 * MINUTE + index * 20_000, "lint");
    // Eleven times in twenty minutes, docker's runner and two of light's stepped aside.
    for (let index = 0; index < 11; index += 1) {
      const docker = index % 3 === 0;
      stepAside(docker ? "docker" : "light", docker ? 1 : index % 3, now - 31 * MINUTE + index * 2 * MINUTE, MINUTE + (index % 3) * 10_000, index % 4 === 0);
    }
    live.slot("linux", 1, "busy", { runner: `${INSTALL}-linux-1-${Math.floor(now / 1000) - 140}` });
    live.job("linux", 1, "ci / test");
    live.slot("linux", 2, "busy", { runner: `${INSTALL}-linux-2-${Math.floor(now / 1000) - 130}` });
    live.job("linux", 2, "ci / integration (node 22, ubuntu)");
    live.slot("docker", 1, "waiting", { detail: "The VM has 0.8 GB free. Runnerbox keeps 2.0 GB free before it starts another runner." });
    ready("light", [1, 2, 3]);
    availableNow = 2_800;
    containers = [
      { name: `${INSTALL}-linux-slot1`, cpuPercent: 180, memMiB: 5_400 },
      { name: `${INSTALL}-linux-slot2`, cpuPercent: 140, memMiB: 4_300 },
    ];
  } else if (scenario === "quiet") {
    ran("linux", 1, now - 52 * MINUTE, 6 * MINUTE, "ci / test");
    ran("linux", 2, now - 50 * MINUTE, 70_000, "ci / build");
    ready("linux", [1, 2]);
    ready("docker", [1]);
    ready("light", [1, 2, 3]);
  } else if (scenario === "failing") {
    linuxHour();
    for (let index = 0; index < 6; index += 1) {
      const start = now - 9 * MINUTE + index * 85_000;
      events.push({ time: iso(start + 3_000), event: "runner", runnerType: "docker", slot: 1, runner: `${INSTALL}-docker-1-${Math.floor(start / 1000)}`, startedAt: iso(start), durationMs: 3_000, exitCode: 125, released: false });
    }
    ready("linux", [1, 2]);
    live.slot("docker", 1, "backoff", { detail: "the last runner exited 125 within a minute" });
    ready("light", [1, 2, 3]);
  } else {
    linuxHour();
    events.push({ time: iso(now - 3 * 24 * 60 * MINUTE), event: "image_build", runnerType: "light", tag: "app-light:3f9a1c2b7d4e", startedAt: iso(now - 3 * 24 * 60 * MINUTE - 3 * MINUTE), durationMs: 3 * MINUTE + 10_000, ok: true });
    ready("linux", [1, 2]);
    ready("docker", [1]);
    ready("light", [1, 2, 3]);
    live.image("light", "app-light:3f9a1c2b7d4e", "app-light:8d2e4f6a1b3c");
  }
  await live.flush();

  // Samples once a minute for the last hour, falling to `availableNow`.
  const samples: Sample[] = Array.from({ length: 60 }, (_, index) => {
    const at = now - (59 - index) * MINUTE;
    const available = Math.round(availableNow + (11_000 - availableNow) * (1 - index / 59) * 0.5);
    return { time: iso(at), host: { totalMiB: 32_768, availableMiB: 14_000, swapUsedMiB: 0, load1: 2 }, vm: { totalMiB: TOTAL_MIB, availableMiB: available, swapUsedMiB: 0, load1: 3 }, containers };
  });
  const readings: ContainerSample[] = containers.length === 0 ? [] : [{ time: iso(now - 10_000), containers }];
  const ndjson = (rows: readonly object[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");
  await mkdir(join(dir, INSTALL), { recursive: true, mode: 0o700 });
  await writeFile(join(dir, INSTALL, "events.ndjson"), ndjson(events.toSorted((a, b) => a.time.localeCompare(b.time))), { mode: 0o600 });
  if (scenario === "no-samples") {
    await rm(join(dir, INSTALL, "samples.ndjson"), { force: true });
    await rm(join(dir, INSTALL, "containers.ndjson"), { force: true });
  } else {
    await writeFile(join(dir, INSTALL, "samples.ndjson"), ndjson(samples), { mode: 0o600 });
    await writeFile(join(dir, INSTALL, "containers.ndjson"), ndjson(readings), { mode: 0o600 });
  }
  await writeFile(join(dir, `${REPO.replace("/", "__")}.ndjson`), ndjson(jobs), { mode: 0o600 });
  return live;
}
