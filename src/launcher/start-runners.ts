import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { mintRegistration, removeRunner } from "../github/runner-registration.ts";
import { buildInVm } from "../image/build-in-vm.ts";
import { hashContext } from "../image/context-hash.ts";
import { createImageKeeper } from "../image/image-keeper.ts";
import type { LauncherEvent } from "../tracking/launcher-event.ts";
import { createRotatingLog } from "../tracking/rotating-log.ts";
import { createSampler, VM_SAMPLE_COMMAND } from "../tracking/sampler.ts";
import { stateDir } from "../tracking/state-dir.ts";
import { readFromVm, runInVm } from "../vm/run-in-vm.ts";
import { dockerRunCommand, shellQuote } from "./docker-command.ts";
import { every } from "./every.ts";
import { type LauncherConfig, loadLauncherConfig } from "./launcher-config.ts";
import { checkMemoryFloor } from "./memory-floor.ts";
import { runSlots } from "./run-slots.ts";
import { readTokenFile } from "./token-file.ts";

const IMAGE_CHECK_MS = 5 * 60_000;
const IMAGE_RETRY_MS = 60_000;
const SAMPLE_MS = 60_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function startRunners(configPath: string) {
  const config = await loadLauncherConfig(configPath);
  const registered = new Map<number, number>();
  // What `up` did and what the machines looked like, kept locally for `report`. See docs/analytics.md.
  const events = createRotatingLog(join(stateDir(), config.name, "events.ndjson"));
  const record = (event: LauncherEvent) => void events.append({ time: new Date().toISOString(), ...event });
  startSampler(config);
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

  const image = await keepImage(config, roomForJob, record);

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
      record,
    },
    registered,
  );
}

// Returns the image new containers should use. A build context is built before any slot starts,
// then checked for changes every few minutes.
async function keepImage(
  config: LauncherConfig,
  roomForJob: () => Promise<string | null>,
  record: (event: LauncherEvent) => void,
) {
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
    record,
    now: Date.now,
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

// One sample a minute of the host, the VM and every container in it, whether or not jobs are running.
function startSampler(config: LauncherConfig) {
  const samples = createRotatingLog(join(stateDir(), config.name, "samples.ndjson"));
  const readProc = (file: string) => readFile(`/proc/${file}`, "utf8");
  const sample = createSampler({
    readHost: async () => ({
      meminfo: await readProc("meminfo"),
      loadavg: await readProc("loadavg"),
      stat: (await readProc("stat")).split("\n")[0] ?? "",
    }),
    readVm: () => readFromVm({ vm: config.vm, command: VM_SAMPLE_COMMAND }),
    append: (record) => samples.append(record),
    now: Date.now,
  });
  void sample();
  every(SAMPLE_MS, sample);
}
