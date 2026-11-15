import type { KindUsage, MachineFit } from "@runnerbox/contracts";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import { listed, memory, memoryOf, plainDuration, plural } from "../inbox/jobs.ts";
import { LOW_MEMORY_SHARE } from "../inbox/rules.ts";

// A minute sample stands for the minute after it.
const SAMPLE_MS = 60_000;

// Whether each install's VM had room over the window, in one sentence. With the floor recorded,
// it says how often free memory fell under it, when new jobs had to wait; without it, how low free
// memory went, and that the records don't say where the floor is. More runners are said to need
// more memory first only when a kind is the bottleneck and memory was short. `floorOf` gives an
// install's VM floor in MiB, or null when its records don't say.
export function machineFit(installs: readonly string[], floorOf: (install: string) => number | null, samples: readonly InstallSample[], kinds: readonly KindUsage[]): MachineFit[] {
  return installs.map((install) => {
    const vm = samples.flatMap(({ install: own, sample }) => (own === install && sample.vm ? [{ time: sample.time, ...sample.vm }] : []));
    const floorMiB = floorOf(install) || null;
    if (vm.length === 0) return { install, floorMiB, lowestMiB: null, totalMiB: null, sentence: "No memory readings for this machine yet. They come from Runnerbox running on it." };
    const lowest = vm.reduce((low, sample) => (sample.availableMiB < low.availableMiB ? sample : low));
    const totalMiB = Math.max(...vm.map((sample) => sample.totalMiB));
    const under = floorMiB === null ? [] : vm.filter((sample) => sample.availableMiB < floorMiB);
    const short = floorMiB === null ? lowest.availableMiB < totalMiB * LOW_MEMORY_SHARE : under.length > 0;
    const day = (time: string) => new Date(time).toLocaleDateString("en-US", { weekday: "long" });
    const days = new Set(under.map((sample) => sample.time.slice(0, 10))).size;
    const room =
      floorMiB === null
        ? `Free memory went as low as ${memoryOf(lowest.availableMiB, totalMiB).part} of ${memoryOf(lowest.availableMiB, totalMiB).whole}, on ${day(lowest.time)}. The machine's records don't say how much memory Runnerbox keeps free.`
        : under.length === 0
          ? `Free memory stayed above the ${memory(floorMiB)} that Runnerbox keeps free the whole time.`
          : `Free memory fell under the ${memory(floorMiB)} that Runnerbox keeps free on ${plural(days, "day")}, for ${plainDuration(under.length * SAMPLE_MS)} in all, and new jobs waited then.`;
    const bottlenecks = kinds.filter((kind) => kind.install === install && kind.bottleneck?.cause === "slots").map((kind) => kind.kind);
    const more = short && bottlenecks.length > 0 ? ` Adding more ${listed(bottlenecks)} runners would need more memory first.` : "";
    return { install, floorMiB, lowestMiB: lowest.availableMiB, totalMiB, sentence: `${room}${more}` };
  });
}
