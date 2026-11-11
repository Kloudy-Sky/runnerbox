type Clock = { wait: (ms: number) => Promise<void>; now: () => number };

const RETRY_MS = 3_000;

// Retries `probe` until it resolves, and rethrows its last failure once `timeoutMs` has passed.
export async function untilAnswers(probe: () => Promise<unknown>, timeoutMs: number, { wait, now }: Clock) {
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      await probe();
      return;
    } catch (error) {
      if (now() >= deadline) throw error;
      await wait(RETRY_MS);
    }
  }
}
