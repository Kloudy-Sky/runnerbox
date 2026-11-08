const MINT_RETRY_MS = 60_000;
const NEXT_RUNNER_MS = 5_000;
// A real job takes longer than this. A faster failure means the VM, SSH or image is broken, and
// retrying right away would mint a registration every few seconds.
const FAST_FAILURE_MS = 60_000;

type SlotActions = {
  mint: (runnerName: string) => Promise<{ runnerId: number; jitConfig: string }>;
  runContainer: (slot: number, registration: string) => Promise<number | null>;
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
  const { mint, runContainer, wait, now, log } = actions;

  for (;;) {
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
    const exitCode = await runContainer(slot, registration.jitConfig);
    registered.delete(slot);
    log(`slot ${slot}: ${runnerName} finished (${exitCode})`);
    await wait(exitCode !== 0 && now() - startedAt < FAST_FAILURE_MS ? MINT_RETRY_MS : NEXT_RUNNER_MS);
  }
}
