import { totalmem } from "node:os";
import { join, resolve } from "node:path";
import { every } from "../launcher/every.ts";
import type { VmInstall } from "../launcher/launcher-config.ts";
import { stateDir } from "../tracking/state-dir.ts";
import { readFromVm } from "../vm/run-in-vm.ts";
import { createChanges } from "./changes.ts";

type FromUp = {
  // Whether any job is running on this install now.
  busy: () => Promise<boolean>;
  // `up`'s drain: busy jobs finish, then it exits for its service manager to start it again.
  drain: (why: string) => void;
};

const MEM_TOTAL = /^MemTotal:\s+(\d+) kB$/m;

// Starts taking approved changes for an install whose config has `"changes": true`.
export function startChanges(config: VmInstall, configPath: string, up: FromUp) {
  const changes = createChanges({
    configPath: resolve(configPath),
    logPath: join(stateDir(), config.name, "changes.ndjson"),
    // Measured here, not taken from the request, so bounds can't be widened from outside.
    machine: async () => {
      const output = await readFromVm({ vm: config.vm, command: "cat /proc/meminfo && nproc" });
      const vmKib = Number(MEM_TOTAL.exec(output)?.[1]);
      const vmCpus = Number(output.trim().split("\n").at(-1));
      if (!Number.isFinite(vmKib) || !Number.isInteger(vmCpus)) throw new Error("couldn't read the VM's memory and CPUs");
      return { hostMiB: Math.floor(totalmem() / 2 ** 20), vmMiB: Math.floor(vmKib / 1024), vmCpus };
    },
    busy: up.busy,
    drain: up.drain,
    every,
    now: Date.now,
    log: (line) => console.log(line),
  });
  changes.begin();
  return changes;
}
