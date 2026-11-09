import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { mintRegistration, removeRunner } from "../github/runner-registration.ts";
import { buildInVm } from "../image/build-in-vm.ts";
import { hashContext } from "../image/context-hash.ts";
import { createImageKeeper } from "../image/image-keeper.ts";
import { readFromVm, runInVm } from "../vm/run-in-vm.ts";
import { dockerRunCommand, shellQuote } from "./docker-command.ts";
import { every } from "./every.ts";
import { type LauncherConfig, loadLauncherConfig } from "./launcher-config.ts";
import { checkMemoryFloor } from "./memory-floor.ts";
import { runSlots } from "./run-slots.ts";
import { readTokenFile } from "./token-file.ts";

const IMAGE_CHECK_MS = 5 * 60_000;
const IMAGE_RETRY_MS = 60_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function startRunners(configPath: string) {
  const config = await loadLauncherConfig(configPath);
  const registered = new Map<number, number>();
  const roomForJob = () =>
    checkMemoryFloor(config.memoryFloor, {
      host: () => readFile("/proc/meminfo", "utf8"),
      vm: () => readFromVm({ vm: config.vm, command: "cat /proc/meminfo" }),
    });

  // A runner still waiting for a job would otherwise stay listed until GitHub notices it's gone.
  async function removeWaitingRunners() {
    const token = await readTokenFile(config.tokenFile);
    await Promise.all(
      [...registered.values()].map(async (runnerId) => {
        try {
          await removeRunner({ scope: config.scope, token, runnerId });
          console.log(`removed runner ${runnerId}`);
        } catch (error) {
          console.log(`could not remove runner ${runnerId}, it may be running a job: ${message(error)}`);
        }
      }),
    );
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void removeWaitingRunners().finally(() => process.exit(0)));
  }

  const image = await keepImage(config, roomForJob);

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
        runInVm({ vm: config.vm, command: dockerRunCommand(config, slot, image()), secret }),
      roomForJob,
      release: async (runnerId) => {
        try {
          await removeRunner({ scope: config.scope, token: await readTokenFile(config.tokenFile), runnerId });
          return true;
        } catch {
          return false;
        }
      },
      every,
      wait: async (ms) => void (await wait(ms)),
      now: Date.now,
      log: console.log,
    },
    registered,
  );
}

// Returns the image new containers should use. A build context is built before any slot starts,
// then checked for changes every few minutes.
async function keepImage(config: LauncherConfig, roomForJob: () => Promise<string | null>) {
  const { image, vm } = config;
  if (typeof image === "string") return () => image;

  const inVm = (command: string) => readFromVm({ vm, command }).then((output) => output.trim() === "yes");
  const keeper = createImageKeeper(image.name, {
    contextHash: () => hashContext(image.context),
    existsInVm: (tag) => inVm(`docker image inspect ${shellQuote(tag)} >/dev/null 2>&1 && echo yes || echo no`),
    build: (tag) => buildInVm({ vm, context: image.context, tag }),
    remove: (tag) => inVm(`docker image rm ${shellQuote(tag)} >/dev/null 2>&1 && echo yes || echo no`),
    roomForJob,
    log: console.log,
  });
  const refresh = () => keeper.refresh().catch((error: unknown) => console.log(`image: ${message(error)}`));

  for (;;) {
    await refresh();
    const tag = keeper.current();
    if (tag) {
      every(IMAGE_CHECK_MS, refresh);
      return () => keeper.current() ?? tag;
    }
    await wait(IMAGE_RETRY_MS);
  }
}
