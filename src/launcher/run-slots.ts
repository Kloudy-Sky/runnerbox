import type { LauncherEvent } from "../tracking/launcher-event.ts";
import type { SlotPhase } from "./slot-state.ts";
import type { JoinMemoryLine } from "./memory-line.ts";

const MINT_RETRY_MS = 60_000;
const NEXT_RUNNER_MS = 5_000;
// A real job takes longer than this. A faster failure means the VM, SSH or image is broken, and
// retrying right away would mint a registration every few seconds.
const FAST_FAILURE_MS = 60_000;
const CHECK_MS = 15_000;

type SlotActions = {
  mint: (runnerName: string) => Promise<{ runnerId: number; jitConfig: string }>;
  runContainer: (slot: number, registration: string, image: string) => Promise<number | null>;
  // The image new containers should use.
  image: () => string;
  // Why there's no room for another job right now, or null when there is.
  roomForJob: () => Promise<string | null>;
  // The same check, taken in turn with every other slot. A slot registers only when this says so.
  joinLine: JoinMemoryLine;
  // Removes a runner that hasn't taken a job. False when GitHub refuses, as it does mid-job.
  release: (runnerId: number) => Promise<boolean>;
  // Calls `check` every `ms` until the returned function is called.
  every: (ms: number, check: () => Promise<void>) => () => void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
  record: (event: LauncherEvent) => void;
  // True once `up` is draining: each slot finishes its current runner, then registers no more.
  stopping: () => boolean;
  // What the slot is doing now, for the live state file. Optional, since nothing depends on it.
  report?: (slot: number, phase: SlotPhase, details?: { runner?: string; detail?: string }) => void;
};

// Keeps `slots` runners waiting for jobs, each with a single-use registration minted here on the
// host. The VM never holds a credential that outlives one job. Runs until `stopping`, then resolves
// once every slot's last runner has ended.
// `registered` maps each slot to the runner it registered and hasn't seen finish, so shutdown can
// remove them.
export async function runSlots(
  installName: string,
  slots: number,
  actions: SlotActions,
  registered = new Map<number, number>(),
) {
  const running = Array.from({ length: slots }, (_, index) =>
    runSlot(installName, index + 1, actions, registered),
  );
  await Promise.all(running);
}

async function runSlot(installName: string, slot: number, actions: SlotActions, registered: Map<number, number>) {
  const { mint, runContainer, image, roomForJob, joinLine, release, every, wait, now, log, record, stopping } = actions;
  const report = actions.report ?? (() => {});
  const iso = (ms: number) => new Date(ms).toISOString();

  while (!stopping()) {
    // A runner takes any job it's offered, so the only time to hold a job back is before registering.
    const turn = joinLine();
    let waitedFor = await turn.room();
    if (waitedFor) {
      const waitStarted = now();
      log(`slot ${slot}: waiting for memory: ${waitedFor}`);
      while (waitedFor && !stopping()) {
        report(slot, "waiting", { detail: waitedFor });
        await wait(CHECK_MS);
        waitedFor = await turn.room();
      }
      record({ event: "memory_wait", slot, startedAt: iso(waitStarted), durationMs: now() - waitStarted });
      if (!stopping()) log(`slot ${slot}: memory is back above the floor`);
    }
    turn.leave();
    if (stopping()) return report(slot, "stopped");

    const runnerName = `${installName}-${slot}-${Math.floor(now() / 1000)}`;
    report(slot, "minting", { runner: runnerName });

    const registration = await mint(runnerName).catch((error: unknown) => {
      log(`slot ${slot}: could not mint a registration: ${error instanceof Error ? error.message : error}`);
      return null;
    });
    if (!registration) {
      report(slot, "backoff", { detail: "could not mint a registration" });
      await wait(MINT_RETRY_MS);
      continue;
    }
    // A drain that began while this mint was in flight couldn't see this runner to remove it.
    if (stopping()) {
      await release(registration.runnerId);
      return report(slot, "stopped");
    }

    registered.set(slot, registration.runnerId);
    report(slot, "registered", { runner: runnerName });
    const startedAt = now();
    // An idle runner is removed when memory drops, so the slot waits again, or when the image changes,
    // so the next job gets it. A refusal means it took a job, which a JIT runner never gives back.
    const startedImage = image();
    let released: false | "memory" | "image" = false;
    let busy = false;
    const stopWatching = every(CHECK_MS, async () => {
      if (busy || released) return;
      const newImage = image() === startedImage ? null : image();
      const short = newImage ? null : await roomForJob();
      if (!newImage && !short) return;
      if (!(await release(registration.runnerId))) {
        busy = true;
        report(slot, "busy", { runner: runnerName });
        return;
      }
      released = newImage ? "image" : "memory";
      log(`slot ${slot}: removed idle ${runnerName}: ${newImage ? `new containers use ${newImage}` : short}`);
    });
    const exitCode = await runContainer(slot, registration.jitConfig, startedImage);
    stopWatching();
    // A runner that finished its job is already gone, so this usually gets a refusal. One that exited
    // without finishing, as when GitHub hands it a job just as that job is cancelled, would
    // otherwise stay listed as offline.
    if (!released) await release(registration.runnerId);
    registered.delete(slot);
    record({ event: "runner", slot, runner: runnerName, startedAt: iso(startedAt), durationMs: now() - startedAt, exitCode, released });
    log(`slot ${slot}: ${runnerName} finished (${exitCode})`);
    if (stopping()) return report(slot, "stopped");
    // A released runner exits fast on purpose, so that isn't a broken VM.
    const brokenFast = !released && exitCode !== 0 && now() - startedAt < FAST_FAILURE_MS;
    report(slot, "backoff", { detail: brokenFast ? `the last runner exited ${exitCode} within a minute` : "starting the next runner" });
    await wait(brokenFast ? MINT_RETRY_MS : NEXT_RUNNER_MS);
  }
  report(slot, "stopped");
}
