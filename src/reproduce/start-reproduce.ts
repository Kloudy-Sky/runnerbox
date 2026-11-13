import { randomBytes } from "node:crypto";
import { every } from "../launcher/every.ts";
import type { MemoryFloor, RunnerType, VmInstall } from "../launcher/launcher-config.ts";
import { execInVm } from "../vm/exec-in-vm.ts";
import { createReproducer } from "./reproducer.ts";
import { memoryMiB } from "../launcher/memory-size.ts";
import { checkPrivateRepo, commitTarball, readSourceToken } from "./source.ts";

type FromUp = {
  // What `up` checks before a slot registers, for a given floor.
  roomForJob: (floor: MemoryFloor) => Promise<string | null>;
  installFloor: MemoryFloor;
  currentImage: (kind: string) => string | null;
  slotsWaiting: () => number;
};

// Starts an install's reproducer, after removing any container an earlier `up` left, for the
// control socket to answer. Only called for an install with a `reproduce` block.
export async function startReproduce(config: VmInstall & { reproduce: { sourceTokenFile: string } }, up: FromUp) {
  const reproducer = createReproducer({
    install: config.name,
    runners: config.runners,
    jobVms: config.jobVms !== undefined,
    currentImage: up.currentImage,
    vm: (command, options) => execInVm({ vm: config.vm, command, ...options }),
    source: async (repo, commit) => {
      const token = await readSourceToken(config.reproduce.sourceTokenFile, config.tokenFile).catch((error: unknown) => {
        throw new Error(`The source token isn't usable: ${error instanceof Error ? error.message : error}`);
      });
      await checkPrivateRepo(repo, token);
      return commitTarball(repo, commit, token);
    },
    // The kind's floor, plus room for the reproduce's own memory limit in the VM.
    roomFor: (runner: RunnerType) => {
      const floor = runner.memoryFloor ?? up.installFloor;
      return up.roomForJob({ hostMiB: floor.hostMiB, vmMiB: floor.vmMiB + memoryMiB(runner.limits.memory) });
    },
    slotsWaiting: up.slotsWaiting,
    every,
    now: Date.now,
    newId: () => randomBytes(4).toString("hex"),
    log: (line) => console.log(line),
  });
  const stopChecking = await reproducer.begin();
  return {
    reproducer,
    // Removes the running reproduce, as `up` drains.
    async close() {
      stopChecking();
      await reproducer.end();
    },
  };
}
