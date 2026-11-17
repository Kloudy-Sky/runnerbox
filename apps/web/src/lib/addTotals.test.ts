import assert from "node:assert/strict";
import { test } from "node:test";
import type { DayTotals } from "@runnerbox/contracts";
import { addMachines, addTotals, comparedPeriods, rangeDays } from "./addTotals.ts";

const day = (date: string, totals: Partial<DayTotals> = {}): DayTotals => ({
  day: date, jobs: 0, passed: 0, failed: 0, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0,
  reviews: 0, reviewsWithFindings: 0, typicalReviewMs: null, reviewCostUsd: 0, ...totals,
});

test("two machines' days add up date by date, and one that hasn't answered adds nothing", () => {
  const box = [day("2026-11-16", { jobs: 30, passed: 28, failed: 2, typicalWaitMs: 10_000, reviews: 1, reviewCostUsd: 0.5 }), day("2026-11-17", { jobs: 10, passed: 10 })];
  const laptop = [day("2026-11-16", { jobs: 10, passed: 9, failed: 1, typicalWaitMs: 2_000, reviews: 2, reviewsWithFindings: 1, reviewCostUsd: 0.25 })];
  const [first, second] = addMachines([box, undefined, laptop]);
  assert.deepEqual(
    { jobs: first?.jobs, passed: first?.passed, failed: first?.failed, reviews: first?.reviews, withFindings: first?.reviewsWithFindings, cost: first?.reviewCostUsd },
    { jobs: 40, passed: 37, failed: 3, reviews: 3, withFindings: 1, cost: 0.75 },
  );
  // The busier machine's typical wait counts three times as much.
  assert.equal(first?.typicalWaitMs, 8_000);
  assert.equal(second?.jobs, 10);
});

test("a typical time ignores what had nothing to time, and is null when nothing did", () => {
  assert.equal(addTotals([day("d", { jobs: 4, typicalWaitMs: 6_000 }), day("d")]).typicalWaitMs, 6_000);
  assert.equal(addTotals([day("d"), day("d")]).typicalReviewMs, null);
});

test("a change is measured on complete days only, with today and the partial oldest date left out", () => {
  const dates = ["01", "02", "03", "04", "05", "06", "07"].map((date, index) => day(date, { jobs: index + 1 }));
  // Seven dates: a three-day range is 05 to 07, compared on 05 and 06 against 03 and 04.
  assert.deepEqual(rangeDays(dates, 3).map((row) => row.day), ["05", "06", "07"]);
  const periods = comparedPeriods(dates, 3);
  assert.deepEqual({ recent: periods?.recent.jobs, before: periods?.before.jobs, span: periods?.span }, { recent: 5 + 6, before: 3 + 4, span: 2 });
  assert.equal(comparedPeriods(dates.slice(-3), 1), null);
});
