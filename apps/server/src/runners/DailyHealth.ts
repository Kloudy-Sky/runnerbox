import { join } from "node:path";
import type { HealthDay, MachineHealth } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { machineLookup } from "../history/machineLookup.ts";
import * as StateLogs from "../history/StateLogs.ts";
import { verdictsByJobId } from "../inbox/rules.ts";
import { isFailure } from "../inbox/jobs.ts";
import { type Rollup, RollupFile, foldDays } from "./healthRollup.ts";
import { dayKey, dayStart, daysBetween } from "./hostDays.ts";
import { machineDays } from "./machineDays.ts";
import * as RunnerState from "./RunnerState.ts";

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(RollupFile));
// Rotation drops weeks of samples at a time, so folding a few times a day keeps every day even
// when no one opens the app. Each request folds too.
const FOLD_EVERY = "6 hours";

// Each install's health day by day: whether it took jobs, its lowest free VM memory and its jobs.
// Worked out from the logs `up` and `report` keep, and folded into a roll-up the server owns.
export class DailyHealth extends Context.Service<
  DailyHealth,
  {
    readonly report: (days: number) => Effect.Effect<ReadonlyArray<MachineHealth>, StateLogs.LogReadError>;
  }
>()("runnerbox/server/runners/DailyHealth") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const runnerState = yield* RunnerState.RunnerState;
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const path = join(serverDir, "health.json");
  const lock = yield* Semaphore.make(1);

  // The roll-up is derived, so one that's missing or unreadable starts again from the logs.
  const readRollup = fs.readFileString(path).pipe(
    Effect.flatMap(decodeFile),
    Effect.map((file): Rollup => file.installs),
    Effect.orElseSucceed((): Rollup => ({})),
  );
  const writeRollup = (installs: Rollup) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify({ v: 1, installs })}\n`)),
      // The answer stands without it, and the next fold writes it again.
      Effect.catchCause((cause) => Effect.logWarning("Couldn't save the daily health roll-up.", cause)),
    );

  const fold = lock.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const [samples, events, installs] = yield* Effect.all([logs.samples(0), logs.events(0), runnerState.current]);
      const since = Math.min(...[samples[0]?.sample.time, events[0]?.startedAt].flatMap((time) => (time === undefined ? [] : [Date.parse(time)])), now);
      const jobs = yield* logs.allJobs(dayStart(since));
      const verdicts = verdictsByJobId(jobs, { machine: machineLookup(samples), events });
      const finished = jobs.flatMap((job) =>
        job.runner === null || job.completedAt === null
          ? []
          : [{ runner: job.runner, completedAt: Date.parse(job.completedAt), machineFault: isFailure(job) && verdicts.get(job.jobId) === "infra" }],
      );
      const computed = machineDays({ now, samples, events, installs, jobs: finished });
      const rollup = foldDays(yield* readRollup, computed, now);
      yield* writeRollup(rollup);
      return { now, rollup, computed, installs };
    }),
  );

  const report = Effect.fn("DailyHealth.report")(function* (days: number) {
    const { now, rollup, computed, installs } = yield* fold;
    const today = dayKey(now);
    const range = daysBetween(dayStart(now, 1 - days), now);
    const names = [...new Set([...Object.keys(rollup), ...computed.map(({ install }) => install)])].toSorted();
    return names.flatMap((install): MachineHealth[] => {
      const live = installs.find((state) => state.install === install);
      const stored = new Map((rollup[install] ?? []).map((day) => [day.day, day]));
      const current = computed.find((each) => each.install === install)?.days.find((day) => day.day === today);
      const healthDays = range.map((start): HealthDay => (dayKey(start) === today ? current : stored.get(dayKey(start))) ?? offDay(start, now));
      // A machine gone for the whole range, and not set up now, has nothing to show.
      if (!live && healthDays.every((day) => day.uptime === "off")) return [];
      // `up` writes a `vmMiB` of 0 when there's no VM to check.
      return [{ install, pauseBelowMiB: live?.memoryFloor?.vmMiB || null, days: healthDays }];
    });
  });

  yield* Effect.forkScoped(fold.pipe(Effect.ignore, Effect.delay(FOLD_EVERY), Effect.forever));
  return DailyHealth.of({ report });
});

// A day with no record at all, every minute of it so far off.
const offDay = (start: number, now: number): HealthDay => ({
  day: dayKey(start),
  uptime: "off",
  upMinutes: 0,
  downMinutes: 0,
  offMinutes: Math.ceil((Math.min(dayStart(start, 1), now) - start) / 60_000),
  lowestVmFreeMiB: null,
  jobsTaken: 0,
  failedBeforeJob: 0,
  failedByMachine: 0,
});

export const layer = Layer.effect(DailyHealth, make);
