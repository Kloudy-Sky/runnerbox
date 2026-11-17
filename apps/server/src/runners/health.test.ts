import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { LauncherEvent } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as StateLogs from "../history/StateLogs.ts";
import * as DailyHealth from "./DailyHealth.ts";
import { dayStart } from "./hostDays.ts";
import { machineDays } from "./machineDays.ts";
import * as RunnerState from "./RunnerState.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Local times, so the days are the host's whatever its zone. 9 November 2026 is a Monday.
const at = (date: number, hour: number, minute = 0, second = 0) => new Date(2026, 10, date, hour, minute, second).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

// One sample a minute, as `up` takes them, from `from` until `to`.
const samplesBetween = (from: number, to: number, vmFree = (_time: number) => 4096): InstallSample[] =>
  Array.from({ length: Math.floor((to - from) / MINUTE) }, (_, index) => from + index * MINUTE + 5_000).map((time) => ({
    install: "laptop",
    sample: { time: iso(time), vm: { totalMiB: 8192, availableMiB: vmFree(time), swapUsedMiB: 0, load1: 0.5 } },
  }));

const runner = (start: number, end: number, exitCode: number | null): LauncherEvent => ({
  install: "laptop",
  event: "runner",
  slot: 1,
  runner: "laptop-1",
  startedAt: iso(start),
  durationMs: end - start,
  exitCode,
  released: false,
});

test("a laptop's night reads as off, and runners failing while it reports read as down", () => {
  // Monday it works from 9 to 5, and sleeps with its runner online until Tuesday's first job.
  // Tuesday Docker stops at noon, so every runner from then on fails within a second.
  const failing = Array.from({ length: 10 }, (_, index) => at(10, 12, index * 30)).map((start) => runner(start, start + 1_000, 125));
  const [laptop] = machineDays({
    now: at(11, 12),
    // Wednesday it's opened for five minutes and shut before a runner comes online.
    samples: [...samplesBetween(at(9, 9), at(9, 17)), ...samplesBetween(at(10, 9), at(10, 17)), ...samplesBetween(at(11, 8), at(11, 8, 5))],
    events: [runner(at(9, 9), at(10, 10), 0), runner(at(10, 10), at(10, 12), 0), ...failing],
    installs: [],
    jobs: [at(10, 9, 50), at(10, 11, 30)].map((completedAt) => ({ runner: "laptop-1", completedAt, machineFault: false })),
  });
  const [monday, tuesday, wednesday] = laptop!.days;

  assert.equal(monday!.uptime, "partial");
  assert.ok(monday!.downMinutes < 5);
  assert.equal(Math.round(monday!.offMinutes / 60), 16);
  // The runner's span covers the night, but `up` wasn't sampling, so the night is still off.
  assert.equal(Math.round(tuesday!.offMinutes / 60), 16);
  assert.equal(tuesday!.uptime, "down");
  assert.equal(Math.round(tuesday!.downMinutes / 60), 5);
  assert.deepEqual([tuesday!.jobsTaken, tuesday!.failedBeforeJob], [2, 10]);
  // A few minutes reporting with no runner online is off, not down.
  assert.equal(wednesday!.uptime, "off");
});

test("each day keeps the least VM memory available in any of its samples", () => {
  const [laptop] = machineDays({
    now: at(12, 12),
    samples: [
      ...samplesBetween(at(9, 9), at(9, 17), (time) => (time < at(9, 14) ? 6000 : time < at(9, 14, 1) ? 180 : 5000)),
      ...samplesBetween(at(10, 9), at(10, 17), (time) => 3000 + Math.round((time - at(10, 9)) / MINUTE)),
      // Wednesday the VM couldn't be reached, so its samples carry the host alone.
      { install: "laptop", sample: { time: iso(at(11, 10)), host: { totalMiB: 16384, availableMiB: 900, swapUsedMiB: 0, load1: 1 } } },
    ],
    events: [],
    installs: [],
    jobs: [],
  });
  assert.deepEqual(laptop!.days.map((day) => day.lowestVmFreeMiB), [180, 3000, null, null]);
});

test("a day's roll-up outlives the minute samples behind it", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "rbx-health-"));
  try {
    const now = Date.now();
    const days = [-3, -2, -1].map((offset) => dayStart(now, offset));
    const lines = days.flatMap((start, index) =>
      Array.from({ length: 24 }, (_, step) =>
        JSON.stringify({ time: iso(start + 10 * HOUR + step * 10 * MINUTE), vm: { totalMiB: 8192, availableMiB: 2000 - index * 500 + step, swapUsedMiB: 0, load1: 1 } }),
      ),
    );
    const samplesFile = join(stateDir, "example", "samples.ndjson");
    await mkdir(join(stateDir, "example"), { recursive: true });
    await writeFile(samplesFile, `${lines.join("\n")}\n`);

    const noLiveState = Layer.succeed(RunnerState.RunnerState, RunnerState.RunnerState.of({ current: Effect.succeed([]), changes: Stream.empty }));
    const report = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* DailyHealth.DailyHealth).report(7);
        }).pipe(
          Effect.provide(DailyHealth.layer.pipe(Layer.provide(Layer.mergeAll(StateLogs.layer, noLiveState)), Layer.provideMerge(ServerPaths.layer(stateDir)), Layer.provideMerge(NodeServices.layer))),
        ),
      );
    const lows = (machines: Awaited<ReturnType<typeof report>>) => machines.find(({ install }) => install === "example")?.days.slice(-4, -1).map((day) => day.lowestVmFreeMiB);

    assert.deepEqual(lows(await report()), [2000, 1500, 1000]);
    // `up` rotates the samples away.
    await rm(samplesFile);
    assert.deepEqual(lows(await report()), [2000, 1500, 1000]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
