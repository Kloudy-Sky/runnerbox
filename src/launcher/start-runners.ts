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
import { type LauncherConfig, loadLauncherConfig, type RunnerType } from "./launcher-config.ts";
import { checkMemoryFloor } from "./memory-floor.ts";
import { runSlots } from "./run-slots.ts";
import { readTokenFile } from "./token-file.ts";

const IMAGE_CHECK_MS = 5 * 60_000;
const IMAGE_RETRY_MS = 60_000;
const SAMPLE_MS = 60_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type RecordEvent = (event: LauncherEvent & { runnerType?: string }) => void;

export async function startRunners(configPath: string) {
  const config = await loadLauncherConfig(configPath);
  // Each runner type's slots, mapped to the runner each has registered and not seen finish.
  const registered = config.runners.map(() => new Map<number, number>());
  // What `up` did and what the machines looked like, kept locally for `report`. See docs/analytics.md.
  const events = createRotatingLog(join(stateDir(), config.name, "events.ndjson"));
  const record: RecordEvent = (event) => void events.append({ time: new Date().toISOString(), ...event });
  startSampler(config);
  // One floor for every runner type, so together they can't overload the machines.
  const roomForJob = () =>
    checkMemoryFloor(config.memoryFloor, {
      host: () => readFile("/proc/meminfo", "utf8"),
      vm: () => readFromVm({ vm: config.vm, command: "cat /proc/meminfo" }),
    });
  const remove = async (runnerId: number) =>
    removeRunner({ scope: config.scope, token: await readTokenFile(config.tokenFile), runnerId });

  // A runner still waiting for a job would otherwise stay listed until GitHub notices it's gone.
  async function removeWaitingRunners() {
    const runnerIds = registered.flatMap((slots) => [...slots.values()]);
    await Promise.all(
      runnerIds.map(async (runnerId) => {
        try {
          await remove(runnerId);
          console.log(`removed runner ${runnerId}`);
        } catch (error) {
          console.log(`could not remove runner ${runnerId}, it may be running a job: ${message(error)}`);
        }
      }),
    );
  }
  // The first signal drains: no new runners, waiting ones removed, and `up` exits once every busy
  // job has finished. A second signal exits at once, leaving busy containers to finish in the VM.
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(1);
      stopping = true;
      console.log(`${signal}: draining. Busy jobs finish first; send it again to exit now.`);
      void removeWaitingRunners();
    });
  }

  await Promise.all(
    config.runners.map(async (runner, index) => {
      const recordForType: RecordEvent = (event) => record({ ...event, runnerType: runner.name });
      const image = await keepImage(config, runner, roomForJob, recordForType);
      await runSlots(
        `${config.name}-${runner.name}`,
        runner.slots,
        {
          mint: async (runnerName) =>
            mintRegistration({
              scope: config.scope,
              token: await readTokenFile(config.tokenFile),
              runnerName,
              label: runner.label,
            }),
          runContainer: async (slot, secret, tag) => {
            const command = dockerRunCommand(config.name, runner, slot, tag);
            const exitCode = await runInVm({ vm: config.vm, command, secret });
            await image.prune();
            return exitCode;
          },
          image: image.current,
          roomForJob,
          release: (runnerId) => remove(runnerId).then(() => true, () => false),
          every,
          wait: async (ms) => void (await wait(ms)),
          now: Date.now,
          log: (line) => console.log(`${runner.name} ${line}`),
          record: recordForType,
          stopping: () => stopping,
        },
        registered[index],
      );
    }),
  );
  // Timers for samples and images would keep the process alive after the last slot returns.
  console.log("drained");
  process.exit(0);
}

// Returns the image a runner type's new containers should use, and a prune that removes old tags
// nothing uses. A build context is built before that type's slots start, then checked for changes
// every few minutes.
async function keepImage(config: LauncherConfig, runner: RunnerType, roomForJob: () => Promise<string | null>, record: RecordEvent) {
  const { vm } = config;
  const { image } = runner;
  if (typeof image === "string") return { current: () => image, prune: async () => {} };

  const inVm = (command: string) => readFromVm({ vm, command }).then((output) => output.trim() === "yes");
  const keeper = createImageKeeper(image.name, {
    contextHash: () => hashContext(image.context),
    existsInVm: (tag) => inVm(`docker image inspect ${shellQuote(tag)} >/dev/null 2>&1 && echo yes || echo no`),
    build: (tag) => buildInVm({ vm, context: image.context, tag }),
    remove: (tag) => inVm(`docker image rm ${shellQuote(tag)} >/dev/null 2>&1 && echo yes || echo no`),
    roomForJob,
    log: (line) => console.log(`${runner.name} ${line}`),
    record,
    now: Date.now,
  });
  const report = (error: unknown) => console.log(`${runner.name} image: ${message(error)}`);
  const refresh = () => keeper.refresh().catch(report);

  for (;;) {
    await refresh();
    const tag = keeper.current();
    if (tag) {
      every(IMAGE_CHECK_MS, refresh);
      return { current: () => keeper.current() ?? tag, prune: () => keeper.prune().catch(report) };
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
