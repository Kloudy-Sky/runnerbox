// Calls `check` every `ms` until the returned function is called. A slow check, such as a hung
// SSH, skips ticks instead of piling up.
export function every(ms: number, check: () => Promise<void>) {
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void check().finally(() => (checking = false));
  }, ms);
  return () => clearInterval(timer);
}
