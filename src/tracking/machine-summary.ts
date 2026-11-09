import { percentile } from "./report.ts";
import type { InstallSample } from "./sample-log.ts";

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
