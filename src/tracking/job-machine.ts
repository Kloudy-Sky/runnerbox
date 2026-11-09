import type { JobRecord } from "./job-record.ts";
import type { InstallSample } from "./sample-log.ts";
import type { Sample } from "./sample-record.ts";

// GitHub's clock and the host's can disagree by seconds, so a sample just outside a job still counts.
const SLACK_MS = 30_000;

// What the machines looked like while one job ran: the lowest available memory and the most swap
// in use across its samples. A sample a minute misses spikes, so these are bounds, not peaks.
export type JobMachine = { samples: number; vmLowMiB?: number; hostLowMiB?: number; vmSwapPeakMiB?: number };

// Returns a lookup from a job to the samples its own install took while it ran. A job counts as an
// install's when its runner is named `<install>-…`, which install names keep unambiguous. Other
// runners, hosted ones or another launcher's, get nothing, since these samples aren't of their
// machine. `samples` must be sorted by time.
export function machineDuringJobs(samples: readonly InstallSample[]) {
  const byInstall = Map.groupBy(samples, ({ install }) => install);
  const lookups = new Map([...byInstall].map(([install, own]) => [install, lookupFor(own.map(({ sample }) => sample))]));
  return (job: Pick<JobRecord, "runner" | "startedAt" | "completedAt">): JobMachine | undefined => {
    const install = [...lookups.keys()].find((name) => job.runner?.startsWith(`${name}-`));
    return install === undefined ? undefined : lookups.get(install)?.(job);
  };
}

function lookupFor(samples: readonly Sample[]) {
  const times = samples.map((sample) => Date.parse(sample.time));

  // The index of the first sample at or after `ms`.
  const firstAtOrAfter = (ms: number) => {
    let [low, high] = [0, times.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((times[middle] ?? Infinity) < ms) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  return ({ startedAt, completedAt, runner }: Pick<JobRecord, "runner" | "startedAt" | "completedAt">): JobMachine | undefined => {
    if (!runner || !startedAt || !completedAt) return;
    const [start, end] = [Date.parse(startedAt) - SLACK_MS, Date.parse(completedAt) + SLACK_MS];
    const during: Sample[] = [];
    for (let index = firstAtOrAfter(start); index < samples.length && (times[index] ?? Infinity) <= end; index++) {
      const sample = samples[index];
      if (sample) during.push(sample);
    }
    if (during.length === 0) return;

    const extreme = (pick: (...values: number[]) => number, values: (number | undefined)[]) => {
      const known = values.filter((value) => value !== undefined);
      return known.length > 0 ? pick(...known) : undefined;
    };
    const machine: JobMachine = { samples: during.length };
    const vmLow = extreme(Math.min, during.map((sample) => sample.vm?.availableMiB));
    const hostLow = extreme(Math.min, during.map((sample) => sample.host?.availableMiB));
    const swapPeak = extreme(Math.max, during.map((sample) => sample.vm?.swapUsedMiB));
    if (vmLow !== undefined) machine.vmLowMiB = vmLow;
    if (hostLow !== undefined) machine.hostLowMiB = hostLow;
    if (swapPeak !== undefined) machine.vmSwapPeakMiB = swapPeak;
    return machine;
  };
}
