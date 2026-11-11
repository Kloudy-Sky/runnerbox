import { machineDuringJobs } from "runnerbox/src/tracking/job-machine.ts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";

// The core's job-to-samples join, plus each machine's total memory from its install's latest
// sample, which the inbox needs to judge "low". `samples` must be sorted by time.
export function machineLookup(samples: readonly InstallSample[]) {
  const during = machineDuringJobs(samples);
  const totals = new Map<string, { vmTotalMiB?: number; hostTotalMiB?: number }>();
  for (const { install, sample } of samples) {
    const total: { vmTotalMiB?: number; hostTotalMiB?: number } = {};
    if (sample.vm) total.vmTotalMiB = sample.vm.totalMiB;
    if (sample.host) total.hostTotalMiB = sample.host.totalMiB;
    totals.set(install, { ...totals.get(install), ...total });
  }
  return (job: JobRecord) => {
    const machine = during(job);
    if (!machine) return undefined;
    const install = [...totals.keys()].find((name) => job.runner?.startsWith(`${name}-`));
    return { ...machine, ...(install === undefined ? {} : totals.get(install)) };
  };
}
