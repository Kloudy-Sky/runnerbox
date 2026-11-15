import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;

// Folds the current rebuild period into a context's hash, so an image with `rebuildDays` gets a new
// tag when a period starts, with no file changed. Periods count from the epoch, so a restart lands
// on the same tag and builds nothing.
export function withRebuildPeriod(filesHash: string, rebuildDays: number | undefined, now: number) {
  if (rebuildDays === undefined) return filesHash;
  const period = Math.floor(now / (rebuildDays * DAY_MS));
  return createHash("sha256").update(`${filesHash}\0${period}`).digest("hex");
}
