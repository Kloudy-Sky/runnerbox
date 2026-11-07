const MINT_RETRY_MS = 60_000;
const NEXT_RUNNER_MS = 5_000;

type SlotActions = {
  mint: (runnerName: string) => Promise<string>;
  runContainer: (slot: number, registration: string) => Promise<number | null>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
};

// Keeps `slots` runners waiting for jobs, each with a single-use registration minted here on the
// host. The VM never holds a credential that outlives one job. Runs until the process is killed.
export async function runSlots(installName: string, slots: number, actions: SlotActions) {
  const running = Array.from({ length: slots }, (_, index) => runSlot(installName, index + 1, actions));
  await Promise.all(running);
}

async function runSlot(installName: string, slot: number, actions: SlotActions) {
  const { mint, runContainer, wait, now, log } = actions;

  for (;;) {
    const runnerName = `${installName}-${slot}-${Math.floor(now() / 1000)}`;

    let registration: string;
    try {
      registration = await mint(runnerName);
    } catch (error) {
      log(`slot ${slot}: could not mint a registration: ${error instanceof Error ? error.message : error}`);
      await wait(MINT_RETRY_MS);
      continue;
    }

    log(`slot ${slot}: ${runnerName} finished (${await runContainer(slot, registration)})`);
    await wait(NEXT_RUNNER_MS);
  }
}
