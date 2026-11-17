import type { InstallExplained, MachineSample } from "@runnerbox/contracts";

const HOUR_MS = 3_600_000;

// An install's free memory over the hour before `now`, from the minute samples, measured where its
// runners are limited: the VM when the server reads the VM, the host otherwise. `floorMiB` is the
// line below which Runnerbox pauses runners, when the records say it. Null with no samples.
export function freeMemory(samples: ReadonlyArray<MachineSample>, install: InstallExplained, now: number) {
  const reading = install.memory._tag === "reading" ? install.memory : null;
  const points = samples.flatMap((sample) => {
    const at = Date.parse(sample.time);
    if (sample.install !== install.install || at < now - HOUR_MS || at > now) return [];
    const machine = reading?.machine === "host" ? sample.host : (sample.vm ?? sample.host);
    return machine ? [{ at, availableMiB: machine.availableMiB, totalMiB: machine.totalMiB }] : [];
  });
  if (points.length === 0) return null;
  return { points, totalMiB: Math.max(...points.map((point) => point.totalMiB)), floorMiB: reading?.floorMiB ?? null };
}

export type FreeMemory = NonNullable<ReturnType<typeof freeMemory>>;
