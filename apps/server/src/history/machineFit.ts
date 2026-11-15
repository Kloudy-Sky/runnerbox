import type { KindUsage, MachineFit } from "@runnerbox/contracts";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import { listed, memory, memoryOf, plainDuration, plural } from "../inbox/jobs.ts";
import { LOW_MEMORY_SHARE } from "../inbox/rules.ts";

// A minute sample stands for the minute after it.
const SAMPLE_MS = 60_000;

// Whether each install's VM had room over the window, in one sentence. With the floor recorded,
// it says how often free memory fell under it, when new jobs had to wait; without it, how low free
// memory went, and that the records don't say where the floor is. More runners are said to need
// more memory first only when a kind is the bottleneck and memory was short.
// `floorOf` gives an install's VM floor in MiB, 0 when Runnerbox holds no job back for VM memory,
// with the kinds that keep a lower floor of their own; or null when its records don't say.
export type Floor = { readonly vmMiB: number; readonly lowerKinds: readonly string[] };

export function machineFit(installs: readonly string[], floorOf: (install: string) => Floor | null, samples: readonly InstallSample[], kinds: readonly KindUsage[]): MachineFit[] {
  return installs.map((install) => {
    const vm = samples.flatMap(({ install: own, sample }) => (own === install && sample.vm ? [{ time: sample.time, ...sample.vm }] : []));
    const floor = floorOf(install);
    // A floor of 0 holds nothing back, so there's no line to draw.
    const floorMiB = floor && floor.vmMiB > 0 ? floor.vmMiB : null;
    if (vm.length === 0) return { install, floorMiB, lowestMiB: null, totalMiB: null, sentence: "No memory readings for this machine yet. They come from Runnerbox running on it." };
    const lowest = vm.reduce((low, sample) => (sample.availableMiB < low.availableMiB ? sample : low));
    const totalMiB = Math.max(...vm.map((sample) => sample.totalMiB));
    const under = floorMiB === null ? [] : vm.filter((sample) => sample.availableMiB < floorMiB);
    const short = floorMiB === null ? lowest.availableMiB < totalMiB * LOW_MEMORY_SHARE : under.length > 0;
    const day = (time: string) => new Date(time).toLocaleDateString("en-US", { weekday: "long" });
    const days = new Set(under.map((sample) => sample.time.slice(0, 10))).size;
    const low = `Free memory went as low as ${memoryOf(lowest.availableMiB, totalMiB).part} of ${memoryOf(lowest.availableMiB, totalMiB).whole}, on ${day(lowest.time)}.`;
    // Kinds that keep less free didn't wait when free memory was between their floor and this one.
    const except = floor && floor.lowerKinds.length > 0 ? `, except on the ${listed([...floor.lowerKinds])} runners, which keep less free` : "";
    const room =
      floor === null
        ? `${low} The machine's records don't say how much memory Runnerbox keeps free.`
        : floorMiB === null
          ? `${low} Runnerbox doesn't hold jobs back for memory on this machine's VM.`
          : under.length === 0
            ? `Free memory stayed above the ${memory(floorMiB)} that Runnerbox keeps free the whole time.`
            : `Free memory fell under the ${memory(floorMiB)} that Runnerbox keeps free on ${plural(days, "day")}, for ${plainDuration(under.length * SAMPLE_MS)} in all, and new jobs waited then${except}.`;
    const bottlenecks = kinds.filter((kind) => kind.install === install && kind.bottleneck?.cause === "slots").map((kind) => kind.kind);
    const more = short && bottlenecks.length > 0 ? ` Adding more ${listed(bottlenecks)} runners would need more memory first.` : "";
    return { install, floorMiB, lowestMiB: lowest.availableMiB, totalMiB, sentence: `${room}${more}` };
  });
}
