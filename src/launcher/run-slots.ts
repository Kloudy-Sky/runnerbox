const MINT_RETRY_MS = 60_000;
const NEXT_RUNNER_MS = 5_000;
// A real job takes longer than this. A faster failure means the VM, SSH or image is broken, and
// retrying right away would mint a registration every few seconds.
const FAST_FAILURE_MS = 60_000;
const MEMORY_CHECK_MS = 15_000;

type SlotActions = {
  mint: (runnerName: string) => Promise<{ runnerId: number; jitConfig: string }>;
  runContainer: (slot: number, registration: string) => Promise<number | null>;
  // Why there's no room for another job right now, or null when there is.
  roomForJob: () => Promise<string | null>;
  // Removes a runner that hasn't taken a job. False when GitHub refuses, as it does mid-job.
  release: (runnerId: number) => Promise<boolean>;
  // Calls `check` every `ms` until the returned function is called.
  every: (ms: number, check: () => Promise<void>) => () => void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
};

// Keeps `slots` runners waiting for jobs, each with a single-use registration minted here on the
// host. The VM never holds a credential that outlives one job. Runs until the process is killed.
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
  const { mint, runContainer, roomForJob, release, every, wait, now, log } = actions;

  for (;;) {
    // A runner takes any job it's offered, so the only time to hold a job back is before registering.
    let waitedFor = await roomForJob();
    if (waitedFor) log(`slot ${slot}: waiting for memory: ${waitedFor}`);
    while (waitedFor) {
      await wait(MEMORY_CHECK_MS);
      waitedFor = await roomForJob();
      if (!waitedFor) log(`slot ${slot}: memory is back above the floor`);
    }

    const runnerName = `${installName}-${slot}-${Math.floor(now() / 1000)}`;

    const registration = await mint(runnerName).catch((error: unknown) => {
      log(`slot ${slot}: could not mint a registration: ${error instanceof Error ? error.message : error}`);
      return null;
    });
    if (!registration) {
      await wait(MINT_RETRY_MS);
      continue;
    }

    registered.set(slot, registration.runnerId);
    const startedAt = now();
    // Memory can drop while a runner waits, so an idle one is removed and the slot waits again.
    const stopWatching = every(MEMORY_CHECK_MS, async () => {
      const reason = await roomForJob();
      if (reason && (await release(registration.runnerId))) log(`slot ${slot}: removed idle ${runnerName}: ${reason}`);
    });
    const exitCode = await runContainer(slot, registration.jitConfig);
    stopWatching();
    registered.delete(slot);
    log(`slot ${slot}: ${runnerName} finished (${exitCode})`);
    await wait(exitCode !== 0 && now() - startedAt < FAST_FAILURE_MS ? MINT_RETRY_MS : NEXT_RUNNER_MS);
  }
}
