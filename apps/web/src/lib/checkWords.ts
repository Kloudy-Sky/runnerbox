import type { Check } from "@runnerbox/contracts";
import { formatAge, formatDuration } from "./format.ts";

// A check's state in the owner's words, as a segment's hover and the opened row say it.
export const checkStateWords = { passed: "passed", failed: "failed", running: "running", waiting: "waiting for a runner", skipped: "skipped", cancelled: "cancelled" } as const satisfies Record<Check["state"], string>;

// How long a check took, or how long it has been going: "38s", "4m in".
export function checkTime(check: Check, now = Date.now()) {
  if (check.state === "running") return check.startedAt ? `${formatAge(check.startedAt, now)} in` : null;
  if (check.state === "waiting") return null;
  return check.durationMs === null ? null : formatDuration(check.durationMs);
}
