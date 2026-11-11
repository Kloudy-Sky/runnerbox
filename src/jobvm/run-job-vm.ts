import { untilAnswers } from "./until-answers.ts";
import type { Virsh } from "./virsh.ts";

const BOOT_TIMEOUT_MS = 3 * 60_000;

type JobVmRun = {
  domain: string;
  pool: string;
  disk: string;
  // The golden volume this job's disk is a thin layer over.
  golden: string;
  // The domain's definition, given the path libvirt put this job's disk at.
  xml: (diskPath: string) => string;
};

type JobVmActions = {
  virsh: Virsh;
  // Resolves once the VM can run a job, and rejects while it can't yet.
  answers: () => Promise<unknown>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
};

// Boots a VM for one job, runs `job` against it, and destroys the VM and its disk whatever
// happened. Returns `job`'s exit code, or null when the VM never became usable.
export async function runJobVm(
  { domain, pool, disk, golden, xml }: JobVmRun,
  { virsh, answers, wait, now, log }: JobVmActions,
  job: () => Promise<number | null>,
) {
  // Both fail when there's nothing to remove, which is the usual case.
  const clear = async () => {
    await virsh(["destroy", domain]).catch(() => {});
    await virsh(["vol-delete", "--pool", pool, disk]).catch(() => {});
  };
  // Whatever this slot left behind goes first, which also kills a job still running there.
  await clear();
  try {
    const capacity = /^Capacity:\s+(\d+)/m.exec(await virsh(["vol-info", "--pool", pool, golden, "--bytes"]))?.[1];
    if (!capacity) throw new Error(`couldn't read the size of ${golden}`);
    await virsh(["vol-create-as", pool, disk, capacity, "--format", "qcow2", "--backing-vol", golden, "--backing-vol-format", "qcow2"]);
    const diskPath = (await virsh(["vol-path", "--pool", pool, disk])).trim();
    await virsh(["create"], xml(diskPath));
    await untilAnswers(answers, BOOT_TIMEOUT_MS, { wait, now });
  } catch (error) {
    log(`${domain}: the job VM didn't start: ${error instanceof Error ? error.message : error}`);
    await clear();
    return null;
  }
  try {
    return await job();
  } finally {
    await clear();
  }
}
