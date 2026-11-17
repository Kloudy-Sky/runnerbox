import type { DayTotals } from "@runnerbox/contracts";

// A typical time from several typical times: each weighted by how many jobs or reviews it stands
// for. A median of medians can't be had exactly, and this keeps a quiet machine or day from
// counting as much as a busy one.
function weighted(parts: ReadonlyArray<{ readonly value: number | null; readonly weight: number }>) {
  const counted = parts.filter((part): part is { value: number; weight: number } => part.value !== null && part.weight > 0);
  const weight = counted.reduce((sum, part) => sum + part.weight, 0);
  return weight === 0 ? null : counted.reduce((sum, part) => sum + part.value * part.weight, 0) / weight;
}

// Several rows, of machines or of days, added up into one.
export function addTotals(rows: ReadonlyArray<DayTotals>, day = rows[0]?.day ?? ""): DayTotals {
  const sum = (pick: (row: DayTotals) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    day,
    jobs: sum((row) => row.jobs),
    passed: sum((row) => row.passed),
    failed: sum((row) => row.failed),
    typicalWaitMs: weighted(rows.map((row) => ({ value: row.typicalWaitMs, weight: row.jobs }))),
    ownMachinesMs: sum((row) => row.ownMachinesMs),
    githubMachinesMs: sum((row) => row.githubMachinesMs),
    reviews: sum((row) => row.reviews),
    reviewsWithFindings: sum((row) => row.reviewsWithFindings),
    typicalReviewMs: weighted(rows.map((row) => ({ value: row.typicalReviewMs, weight: row.reviews }))),
    reviewCostUsd: sum((row) => row.reviewCostUsd),
  };
}

// Every machine's days added up date by date, oldest first. A machine that hasn't answered adds
// nothing, and a date only one machine has still shows.
export function addMachines(machines: ReadonlyArray<ReadonlyArray<DayTotals> | undefined>): DayTotals[] {
  const byDay = Map.groupBy(machines.flatMap((days) => days ?? []), (row) => row.day);
  return [...byDay.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => addTotals(rows, day));
}

// The window asked for is twice the range plus today, as `days + 1` dates: the oldest only partly
// inside it and the newest today so far. The range is its last `length` dates, today included.
export const rangeDays = (days: ReadonlyArray<DayTotals>, length: number) => days.slice(-length);

// What a change from the period before is measured on: the range's complete dates, today left out
// since it's only partway through, against as many complete dates just before them. A one-day range
// has no complete date to compare, so it gets none.
export function comparedPeriods(days: ReadonlyArray<DayTotals>, length: number) {
  const complete = days.slice(1, -1);
  const span = length - 1;
  if (span < 1 || complete.length < 2 * span) return null;
  return { recent: addTotals(complete.slice(-span)), before: addTotals(complete.slice(-2 * span, -span)), span };
}
