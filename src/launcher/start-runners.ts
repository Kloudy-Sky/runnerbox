import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { mintRegistration, removeRunner } from "../github/runner-registration.ts";
import { readFromVm, runInVm } from "../vm/run-in-vm.ts";
import { dockerRunCommand } from "./docker-command.ts";
import { loadLauncherConfig } from "./launcher-config.ts";
import { checkMemoryFloor } from "./memory-floor.ts";
import { runSlots } from "./run-slots.ts";
import { readTokenFile } from "./token-file.ts";

export async function startRunners(configPath: string) {
  const config = await loadLauncherConfig(configPath);
  const registered = new Map<number, number>();

  // A runner still waiting for a job would otherwise stay listed until GitHub notices it's gone.
  async function removeWaitingRunners() {
    const token = await readTokenFile(config.tokenFile);
    await Promise.all(
      [...registered.values()].map(async (runnerId) => {
        try {
          await removeRunner({ scope: config.scope, token, runnerId });
          console.log(`removed runner ${runnerId}`);
        } catch (error) {
          console.log(`could not remove runner ${runnerId}, it may be running a job: ${error instanceof Error ? error.message : error}`);
        }
      }),
    );
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void removeWaitingRunners().finally(() => process.exit(0)));
  }

  await runSlots(
    config.name,
    config.slots,
    {
      mint: async (runnerName) =>
        mintRegistration({
          scope: config.scope,
          token: await readTokenFile(config.tokenFile),
          runnerName,
          label: config.label,
        }),
      runContainer: (slot, secret) =>
        runInVm({ vm: config.vm, command: dockerRunCommand(config, slot), secret }),
      roomForJob: () =>
        checkMemoryFloor(config.memoryFloor, {
          host: () => readFile("/proc/meminfo", "utf8"),
          vm: () => readFromVm({ vm: config.vm, command: "cat /proc/meminfo" }),
        }),
      release: async (runnerId) => {
        try {
          await removeRunner({ scope: config.scope, token: await readTokenFile(config.tokenFile), runnerId });
          return true;
        } catch {
          return false;
        }
      },
      every: (ms, check) => {
        // A slow check (a hung SSH) skips ticks instead of piling up.
        let checking = false;
        const timer = setInterval(() => {
          if (checking) return;
          checking = true;
          void check().finally(() => (checking = false));
        }, ms);
        return () => clearInterval(timer);
      },
      wait: async (ms) => void (await wait(ms)),
      now: Date.now,
      log: console.log,
    },
    registered,
  );
}
