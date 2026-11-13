import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { refusePublicScope } from "../github/public-scope.ts";
import { anyRunnerBusy, mintRegistration, removeRunner } from "../github/runner-registration.ts";
import { installPaths } from "../host/install-paths.ts";
import { buildInVm } from "../image/build-in-vm.ts";
import { hashContext } from "../image/context-hash.ts";
import { createImageKeeper } from "../image/image-keeper.ts";
import type { InTurn } from "../jobvm/in-turn.ts";
import { startJobVms } from "../jobvm/start-job-vms.ts";
import type { LauncherEvent } from "../tracking/launcher-event.ts";
import { startChanges } from "../changes/start-changes.ts";
import { listenForControl } from "../control/socket.ts";
import { startReproduce } from "../reproduce/start-reproduce.ts";
import { createRotatingLog } from "../tracking/rotating-log.ts";
import { createSampler, VM_SAMPLE_COMMAND } from "../tracking/sampler.ts";
import { stateDir } from "../tracking/state-dir.ts";
import { readFromVm, runInVm } from "../vm/run-in-vm.ts";
import { dockerRunCommand, shellQuote } from "./docker-command.ts";
import { every } from "./every.ts";
import { loadLauncherConfig, type MemoryFloor, type RunnerType, type VmInstall } from "./launcher-config.ts";
import { checkMemoryFloor, memAvailableMiB, vmStatAvailableMiB } from "./memory-floor.ts";
import { createMemoryLine } from "./memory-line.ts";
import { runSlots } from "./run-slots.ts";
import { runWithSecret } from "./run-with-secret.ts";
import { createSlotState } from "./slot-state.ts";
import { readTokenFile } from "./token-file.ts";

const IMAGE_CHECK_MS = 5 * 60_000;
const IMAGE_RETRY_MS = 60_000;
const SAMPLE_MS = 60_000;
// Often enough that a reader can tell within a minute that `up` stopped without saying so.
const HEARTBEAT_MS = 15_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A Mac reports its memory through vm_stat, and Linux through /proc.
const hostAvailableMiB = async () =>
  process.platform === "darwin"
    ? vmStatAvailableMiB((await promisify(execFile)("vm_stat")).stdout)
    : memAvailableMiB(await readFile("/proc/meminfo", "utf8"));

// How one install runs a job: what its slots call the thing a job runs in, and the command that
// runs one job and returns its exit code.
type Job = { image: () => string; run: (slot: number, registration: string, image: string) => Promise<number | null> };

type RecordEvent = (event: LauncherEvent & { runnerType?: string }) => void;

export async function startRunners(configPath: string) {
  const config = await loadLauncherConfig(configPath);
  // Each runner type's slots, mapped to the runner each has registered and not seen finish.
  const registered = config.runners.map(() => new Map<number, number>());
  // What `up` did and what the machines looked like, kept locally for `report`. See docs/analytics.md.
  const events = createRotatingLog(join(stateDir(), config.name, "events.ndjson"));
  const record: RecordEvent = (event) => void events.append({ time: new Date().toISOString(), ...event });
  // Samples come from /proc on the host and the VM, so a host install has none.
  if ("vm" in config) startSampler(config);
  // What each slot is doing now, for `runnerbox serve` to show live.
  const slotState = createSlotState(join(stateDir(), config.name, "state.json"), config.name, config.runners);
  void slotState.flush();
  every(HEARTBEAT_MS, slotState.heartbeat);
  // Every runner type checks the install's floor unless it sets its own, so together they can't
  // overload the machines. A host install has no VM, so its VM floor is 0, which skips that check.
  const installFloor: MemoryFloor = { vmMiB: 0, ...config.memoryFloor };
  const roomForJob = (floor: MemoryFloor) =>
    checkMemoryFloor([
      { name: "host", floorMiB: floor.hostMiB, availableMiB: hostAvailableMiB },
      ...("vm" in config
        ? [
            {
              name: "VM",
              floorMiB: floor.vmMiB,
              availableMiB: async () => memAvailableMiB(await readFromVm({ vm: config.vm, command: "cat /proc/meminfo" })),
            },
          ]
        : []),
    ]);
  const joinLine = createMemoryLine(roomForJob);
  const remove = async (runnerId: number) =>
    removeRunner({ scope: config.scope, token: await readTokenFile(config.tokenFile), runnerId });

  // Slots waiting for memory, which a reproduce container yields to.
  const waitingSlots = new Set<string>();
  // Each kind's image for new containers, once ready, for a reproduce on that kind.
  const images = new Map<string, () => string>();
  const reproduce =
    "vm" in config && config.reproduce
      ? await startReproduce(
          { ...config, reproduce: config.reproduce },
          { roomForJob, installFloor, currentImage: (kind) => images.get(kind)?.() ?? null, slotsWaiting: () => waitingSlots.size },
        )
      : null;

  // Approved changes to this file's numbers, when it has `"changes": true`. Applying one drains.
  const changes =
    "vm" in config && config.changes
      ? startChanges(config, configPath, {
          busy: async () =>
            anyRunnerBusy({ scope: config.scope, token: await readTokenFile(config.tokenFile), runnerIds: registered.flatMap((slots) => [...slots.values()]) }),
          drain,
        })
      : null;
  // `runnerbox serve`'s way in, only when the config turns on something it can ask for.
  const control = reproduce || changes ? await listenForControl(join(stateDir(), config.name), { reproducer: reproduce?.reproducer ?? null, changes }) : null;

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
  // Draining: no new runners, waiting ones removed, and `up` exits once every busy job has finished,
  // for its service manager to start it again. The first signal does it, and so does an applied
  // change. A second signal exits at once, leaving busy containers to finish in the VM.
  let stopping = false;
  function drain(why: string) {
    if (stopping) return;
    stopping = true;
    void slotState.stopping();
    control?.close();
    void reproduce?.close();
    void changes?.close();
    console.log(`${why}: draining. Busy jobs finish first.`);
    void removeWaitingRunners();
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(1);
      drain(signal);
      console.log("Send it again to exit now.");
    });
  }

  const startSlots = (
    runner: { name: string; label: string; slots: number; memoryFloor?: MemoryFloor },
    index: number,
    job: Job,
  ) => {
    const floor = runner.memoryFloor ?? installFloor;
    return runSlots(
      `${config.name}-${runner.name}`,
      runner.slots,
      {
        // Checked before every registration, because a repository can be made public while this runs.
        mint: async (runnerName) => {
          const token = await readTokenFile(config.tokenFile);
          if (!config.allowPublicRepos) await refusePublicScope(config.scope, token);
          return mintRegistration({ scope: config.scope, token, runnerName, label: runner.label });
        },
        runContainer: job.run,
        image: job.image,
        roomForJob: () => roomForJob(floor),
        joinLine: () => joinLine(floor),
        release: (runnerId) => remove(runnerId).then(() => true, () => false),
        every,
        wait: async (ms) => void (await wait(ms)),
        now: Date.now,
        log: (line) => console.log(`${runner.name} ${line}`),
        record: (event) => record({ ...event, runnerType: runner.name }),
        stopping: () => stopping,
        report: (slot, phase, details) => {
          if (phase === "waiting") waitingSlots.add(`${runner.name} ${slot}`);
          else waitingSlots.delete(`${runner.name} ${slot}`);
          slotState.slot(runner.name, slot, phase, details);
        },
      },
      registered[index],
    );
  };

  if ("vm" in config) {
    // With job VMs, the VM in the config only builds images, and it does one thing at a time.
    const jobVms = config.jobVms ? await startJobVms(config, config.jobVms) : null;
    const inBuilder: InTurn = jobVms?.inBuilder ?? ((task) => task());
    await Promise.all(
      config.runners.map(async (runner, index) => {
        const recordForType: RecordEvent = (event) => record({ ...event, runnerType: runner.name });
        const onImage = (current: string | null, building: string | null) => slotState.image(runner.name, current, building);
        const image = await keepImage(config, runner, () => roomForJob(installFloor), recordForType, () => stopping, onImage, inBuilder);
        // Draining before this kind's image was ever ready, so it has no slots to wait for.
        if (!image) return;
        images.set(runner.name, image.current);
        await startSlots(runner, index, {
          image: image.current,
          run: async (slot, secret, tag) => {
            const command = dockerRunCommand(config.name, runner, slot, tag);
            const exitCode = jobVms
              ? await jobVms.run(runner, slot, tag, (vm) => runInVm({ vm, command, secret }))
              : await runInVm({ vm: config.vm, command, secret });
            await image.prune();
            return exitCode;
          },
        });
      }),
    );
  } else {
    // sudo -n fails instead of asking for a password, which setup.sh's rule makes unnecessary.
    const { runJob } = installPaths(config);
    await Promise.all(
      config.runners.map((runner, index) =>
        startSlots(runner, index, { image: () => "host", run: (_slot, secret) => runWithSecret("sudo", ["-n", runJob], secret) }),
      ),
    );
  }
  // Timers for samples and images would keep the process alive after the last slot returns.
  console.log("drained");
  await slotState.flush();
  process.exit(0);
}

// Returns the image a runner type's new containers should use, and a prune that removes old tags
// nothing uses. A build context is built before that type's slots start, then checked for changes
// every few minutes.
async function keepImage(
  config: VmInstall,
  runner: RunnerType,
  roomForJob: () => Promise<string | null>,
  record: RecordEvent,
  stopping: () => boolean,
  // Tells the live state file which tag new containers use, and which one is building.
  onImage: (current: string | null, building: string | null) => void,
  // Gives a task the VM to itself. With job VMs, a disk copy shuts it down between tasks.
  inBuilder: InTurn,
) {
  const { vm } = config;
  const { image } = runner;
  if (typeof image === "string") {
    onImage(image, null);
    return { current: () => image, prune: async () => {} };
  }

  const inVm = (command: string) => inBuilder(() => readFromVm({ vm, command })).then((output) => output.trim() === "yes");
  const keeper = createImageKeeper(image.name, {
    contextHash: () => hashContext(image.context),
    existsInVm: (tag) => inVm(`docker image inspect ${shellQuote(tag)} >/dev/null 2>&1 && echo yes || echo no`),
    build: async (tag) => {
      onImage(keeper.current(), tag);
      try {
        return await inBuilder(() => buildInVm({ vm, context: image.context, tag }));
      } finally {
        onImage(keeper.current(), null);
      }
    },
    remove: (tag) => inVm(`docker image rm ${shellQuote(tag)} >/dev/null 2>&1 && echo yes || echo no`),
    roomForJob,
    log: (line) => console.log(`${runner.name} ${line}`),
    record,
    now: Date.now,
  });
  const report = (error: unknown) => console.log(`${runner.name} image: ${message(error)}`);
  const refresh = () => keeper.refresh().catch(report).then(() => onImage(keeper.current(), null));

  while (!stopping()) {
    await refresh();
    const tag = keeper.current();
    if (tag) {
      every(IMAGE_CHECK_MS, refresh);
      return { current: () => keeper.current() ?? tag, prune: () => keeper.prune().catch(report) };
    }
    await wait(IMAGE_RETRY_MS);
  }
  return null;
}

// One sample a minute of the host, the VM and every container in it, whether or not jobs are running.
function startSampler(config: VmInstall) {
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
