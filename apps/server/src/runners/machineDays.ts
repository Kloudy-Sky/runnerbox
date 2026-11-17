import type { DayUptime, HealthDay, InstallState, LauncherEvent } from "@runnerbox/contracts";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import { dayKey, dayStart, daysBetween } from "./hostDays.ts";

const MINUTE_MS = 60_000;
// `up` treats a runner that exited with an error within a minute as a broken machine and backs
// off. The same line here tells a runner that never reached a job from one that took one.
const FAST_FAILURE_MS = 60_000;
// Up all but this many minutes still reads as up all day: a restart for an update, or a sample or
// two missed, isn't a gap anyone needs to see.
const ALL_DAY_SLACK_MINUTES = 30;
// Down at least this long marks the day down even when it took jobs too. Shorter stretches come
// with a Docker restart or a new image and mend themselves.
const DOWN_MINUTES = 30;
// A slot in these phases has a runner online, or about to be, that can take a job.
const ONLINE = new Set(["minting", "registered", "busy"]);

// A job a self-hosted runner finished, by the runner that ran it. `machineFault` is a failure the
// history judged the machine's, the `infra` verdict.
export type FinishedJob = { readonly runner: string; readonly completedAt: number; readonly machineFault: boolean };

export type DaysInput = {
  readonly now: number;
  // Both sorted by time, as StateLogs reads them.
  readonly samples: readonly InstallSample[];
  readonly events: readonly LauncherEvent[];
  readonly installs: readonly InstallState[];
  readonly jobs: readonly FinishedJob[];
};

// `coveredFrom` is the oldest record the logs still hold for the install: days from its start on
// are complete in the logs, and older ones have lost records to rotation.
export type InstallDays = { readonly install: string; readonly coveredFrom: number; readonly days: ReadonlyArray<HealthDay> };

const failedFast = (event: LauncherEvent) => event.event === "runner" && event.released === false && event.exitCode !== 0 && event.durationMs < FAST_FAILURE_MS;
const endOf = (event: LauncherEvent) => Date.parse(event.startedAt) + event.durationMs;

const markSpan = (minutes: Set<number>, from: number, to: number) => {
  for (let minute = Math.floor(from / MINUTE_MS); minute <= Math.floor(to / MINUTE_MS); minute++) minutes.add(minute);
};

const countBy = <T>(items: readonly T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
};

const uptimeOf = ({ upMinutes, downMinutes, offMinutes }: Pick<HealthDay, "upMinutes" | "downMinutes" | "offMinutes">): DayUptime => {
  const dayMinutes = upMinutes + downMinutes + offMinutes;
  if (downMinutes >= DOWN_MINUTES) return "down";
  // Reporting a few minutes without a runner online, as a laptop opened and shut again, isn't a fault.
  if (upMinutes === 0) return "off";
  return upMinutes >= dayMinutes - ALL_DAY_SLACK_MINUTES ? "up" : "partial";
};

// Each install's days from its oldest record to today, minute by minute.
//
// Off and down are told apart by who is speaking. `up` writes a sample every minute while it runs,
// jobs or none, VM reachable or not, so a minute with no sample is a minute `up` wasn't running:
// off, as a laptop at night. A minute with a sample but no healthy runner online is down: `up` was
// there, but its runners failed within a minute, it couldn't register them, or they waited for
// memory. A runner's own span can't stand in for samples, since a laptop that sleeps with a runner
// online wakes to an event that covers the whole night. Host installs take no samples, so for them
// any event or the live state's span is what says `up` was running.
export function machineDays(input: DaysInput): InstallDays[] {
  const { now } = input;
  const names = new Set([...input.samples.map(({ install }) => install), ...input.events.map(({ install }) => install), ...input.installs.map(({ install }) => install)]);
  // The longest name first, so a runner of `a-b` isn't counted for `a`.
  const byPrefix = [...names].toSorted((a, b) => b.length - a.length);
  const jobsOf = Map.groupBy(input.jobs, ({ runner }) => byPrefix.find((name) => runner.startsWith(`${name}-`)) ?? "");
  const samplesOf = Map.groupBy(input.samples, ({ install }) => install);
  const eventsOf = Map.groupBy(input.events, ({ install }) => install);

  return [...names].toSorted().map((install): InstallDays => {
    const samples = samplesOf.get(install) ?? [];
    const events = eventsOf.get(install) ?? [];
    const live = input.installs.find((state) => state.install === install && !state.stale);

    const healthy = new Set<number>();
    for (const event of events) if (event.event === "runner" && !failedFast(event)) markSpan(healthy, Date.parse(event.startedAt), endOf(event));
    for (const slot of live?.kinds.flatMap((kind) => kind.slots) ?? []) if (ONLINE.has(slot.phase)) markSpan(healthy, Date.parse(slot.since), now);

    const reporting = new Set<number>();
    // A sample stands for the minute it was taken in and the one before, since the sampler's
    // minute drifts by the seconds a read takes and would otherwise leave false one-minute gaps.
    for (const { sample } of samples) markSpan(reporting, Date.parse(sample.time) - MINUTE_MS, Date.parse(sample.time));
    if (samples.length === 0) {
      for (const event of events) markSpan(reporting, Date.parse(event.startedAt), endOf(event));
      if (live) markSpan(reporting, Date.parse(live.startedAt), now);
    }

    const lowest = new Map<string, number>();
    for (const { sample } of samples) {
      const free = sample.vm?.availableMiB;
      if (free === undefined) continue;
      const day = dayKey(Date.parse(sample.time));
      lowest.set(day, Math.min(free, lowest.get(day) ?? Infinity));
    }
    // Jobs come from the job log, not runner events: a drain removes idle runners without marking
    // them released, so a runner that ran a long time didn't necessarily take a job.
    const jobs = jobsOf.get(install) ?? [];
    const taken = countBy(jobs, ({ completedAt }) => dayKey(completedAt));
    const failedByMachine = countBy(jobs.filter(({ machineFault }) => machineFault), ({ completedAt }) => dayKey(completedAt));
    const failedBefore = countBy(events.filter(failedFast), (event) => dayKey(endOf(event)));

    // Samples rotate out long before events, which are a line per runner, so samples set coverage.
    const oldest = samples.length > 0 ? [samples[0]!.sample.time] : [events[0]?.startedAt, live?.startedAt];
    const coveredFrom = Math.min(...oldest.flatMap((time) => (time === undefined ? [] : [Date.parse(time)])), now);

    const days = daysBetween(coveredFrom, now).map((start): HealthDay => {
      const end = Math.min(dayStart(start, 1), now);
      let upMinutes = 0;
      let downMinutes = 0;
      let offMinutes = 0;
      for (let minute = Math.floor(start / MINUTE_MS); minute < Math.ceil(end / MINUTE_MS); minute++) {
        if (!reporting.has(minute)) offMinutes++;
        else if (healthy.has(minute)) upMinutes++;
        else downMinutes++;
      }
      const day = dayKey(start);
      const minutes = { upMinutes, downMinutes, offMinutes };
      return {
        day,
        uptime: uptimeOf(minutes),
        ...minutes,
        lowestVmFreeMiB: lowest.get(day) ?? null,
        jobsTaken: taken.get(day) ?? 0,
        failedBeforeJob: failedBefore.get(day) ?? 0,
        failedByMachine: failedByMachine.get(day) ?? 0,
      };
    });
    return { install, coveredFrom, days };
  });
}
