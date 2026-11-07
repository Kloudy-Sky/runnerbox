import { setTimeout as wait } from "node:timers/promises";
import { mintRegistration } from "../github/runner-registration.ts";
import { runInVm } from "../vm/run-in-vm.ts";
import { dockerRunCommand } from "./docker-command.ts";
import { loadLauncherConfig } from "./launcher-config.ts";
import { runSlots } from "./run-slots.ts";
import { readTokenFile } from "./token-file.ts";

export async function startRunners(configPath: string) {
  const config = await loadLauncherConfig(configPath);

  await runSlots(config.name, config.slots, {
    mint: async (runnerName) =>
      mintRegistration({
        scope: config.scope,
        token: await readTokenFile(config.tokenFile),
        runnerName,
        label: config.label,
      }),
    runContainer: (slot, secret) =>
      runInVm({ vm: config.vm, command: dockerRunCommand(config, slot), secret }),
    wait: async (ms) => void (await wait(ms)),
    now: Date.now,
    log: console.log,
  });
}
