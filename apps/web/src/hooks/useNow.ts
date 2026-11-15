import { useSyncExternalStore } from "react";

// The time, moving on every `intervalMs`, or held still when it's null. Rounded to the step, so
// React sees the same value between ticks. After T3 Code's sidebar update capsule.
export function useNow(intervalMs: number | null) {
  const step = intervalMs ?? 60_000;
  const subscribe = (onChange: () => void) => {
    if (intervalMs === null) return () => {};
    const timer = setInterval(onChange, intervalMs);
    return () => clearInterval(timer);
  };
  return useSyncExternalStore(subscribe, () => Math.floor(Date.now() / step) * step);
}
