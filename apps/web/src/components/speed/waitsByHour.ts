import type { JobRun } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
// A cell with fewer jobs than this is too thin to name as the slowest hour.
const ENOUGH_JOBS = 3;
// Waits under this aren't worth a sentence: a runner was there.
const NOTICEABLE_MS = 5_000;

export type WaitCell = { readonly jobs: number; readonly typicalMs: number | null };

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? null : sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

// Each job's wait for a runner, by the weekday and hour it was queued in the viewer's own time,
// Monday first: seven rows of 24 cells with the typical wait in each.
export function waitGrid(runs: readonly JobRun[]): WaitCell[][] {
  const waits = WEEKDAYS.map(() => Array.from({ length: 24 }, (): number[] => []));
  for (const run of runs) {
    if (run.queueMs === null) continue;
    const queued = new Date(run.createdAt);
    waits[(queued.getDay() + 6) % 7]![queued.getHours()]!.push(run.queueMs);
  }
  return waits.map((hours) => hours.map((own) => ({ jobs: own.length, typicalMs: median(own) })));
}

// The hour jobs waited longest, in a sentence, or that they hardly waited at all.
export function waitSentence(grid: readonly (readonly WaitCell[])[]): string | null {
  const cells = grid.flatMap((hours, weekday) => hours.map((cell, hour) => ({ ...cell, weekday, hour })));
  if (cells.every((cell) => cell.jobs === 0)) return null;
  const slowest = cells
    .flatMap((cell) => (cell.jobs >= ENOUGH_JOBS && cell.typicalMs !== null ? [{ ...cell, typicalMs: cell.typicalMs }] : []))
    .toSorted((a, b) => b.typicalMs - a.typicalMs)[0];
  if (!slowest || slowest.typicalMs < NOTICEABLE_MS) return "Jobs hardly wait: a runner is usually free within seconds, at every hour.";
  return `Jobs wait longest on ${WEEKDAYS[slowest.weekday]}s from ${String(slowest.hour).padStart(2, "0")}:00, typically ${formatDuration(slowest.typicalMs)}.`;
}
