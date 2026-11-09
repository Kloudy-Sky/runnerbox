import type { LauncherEvent } from "./launcher-event.ts";
import { percentile } from "./report.ts";
import type { InstallSample } from "./sample-log.ts";

export type LauncherRow = {
  install: string;
  runnerType: string;
  runners: number;
  // Containers that ended non-zero or lost SSH, not counting ones the slot removed on purpose.
  failedRunners: number;
  releasedForMemory: number;
  releasedForImage: number;
  memoryWaits: number;
  memoryWaitP90Ms: number | null;
  imageBuilds: number;
  failedBuilds: number;
  buildP50Ms: number | null;
};

export function summarizeLauncher(events: readonly { install: string; record: LauncherEvent }[]): LauncherRow[] {
  const groups = Map.groupBy(events, ({ install, record }) => `${install}\0${record.runnerType ?? "-"}`);
  return [...groups.values()].map((group) => {
    const records = group.map(({ record }) => record);
    const runners = records.filter((record) => record.event === "runner");
    const waits = records.filter((record) => record.event === "memory_wait");
    const builds = records.filter((record) => record.event === "image_build");
    return {
      install: group[0]?.install ?? "-",
      runnerType: group[0]?.record.runnerType ?? "-",
      runners: runners.length,
      failedRunners: runners.filter((runner) => !runner.released && runner.exitCode !== 0).length,
      releasedForMemory: runners.filter((runner) => runner.released === "memory").length,
      releasedForImage: runners.filter((runner) => runner.released === "image").length,
      memoryWaits: waits.length,
      memoryWaitP90Ms: percentile(waits.map((wait) => wait.durationMs), 90),
      imageBuilds: builds.length,
      failedBuilds: builds.filter((build) => !build.ok).length,
      buildP50Ms: percentile(builds.filter((build) => build.ok).map((build) => build.durationMs), 50),
    };
  });
}

export type MachineRow = {
  install: string;
  samples: number;
  vmAvailableP10MiB: number | null;
  vmAvailableMinMiB: number | null;
  vmSwapP90MiB: number | null;
  hostAvailableP10MiB: number | null;
};

// How close each install's machines came to running out. The 10th percentile of available memory
// is the level it was below one minute in ten.
export function summarizeMachines(samples: readonly InstallSample[]): MachineRow[] {
  return [...Map.groupBy(samples, ({ install }) => install)].map(([install, group]) => {
    const values = (pick: (sample: InstallSample["sample"]) => number | undefined) =>
      group.map(({ sample }) => pick(sample)).filter((value) => value !== undefined);
    const vmAvailable = values((sample) => sample.vm?.availableMiB);
    return {
      install,
      samples: group.length,
      vmAvailableP10MiB: percentile(vmAvailable, 10),
      vmAvailableMinMiB: vmAvailable.length > 0 ? Math.min(...vmAvailable) : null,
      vmSwapP90MiB: percentile(values((sample) => sample.vm?.swapUsedMiB), 90),
      hostAvailableP10MiB: percentile(values((sample) => sample.host?.availableMiB), 10),
    };
  });
}
