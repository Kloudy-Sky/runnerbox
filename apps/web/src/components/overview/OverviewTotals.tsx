import type { DayTotals } from "@runnerbox/contracts";
import type { comparedPeriods } from "../../lib/addTotals.ts";
import { formatDuration } from "../../lib/format.ts";
import { hoursText, percentText } from "./durationWords.ts";

type Compared = NonNullable<ReturnType<typeof comparedPeriods>>;

function Total({ label, value, under, why }: { label: string; value: string; under: string | null; why: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold text-[28px] leading-tight tracking-tight">{value}</div>
      {under ? (
        <div className="text-muted-foreground/75 text-xs" title={why}>
          {under}
        </div>
      ) : null}
    </div>
  );
}

// "9% more than last week", or "same as".
function change(now: number, before: number, words: string, percent: boolean) {
  const difference = percent ? Math.round(((now - before) / before) * 100) : now - before;
  if (difference === 0) return `same as ${words}`;
  return `${Math.abs(difference).toLocaleString()}${percent ? "%" : ""} ${difference > 0 ? "more" : "fewer"} than ${words}`;
}

const rate = (totals: DayTotals) => percentText(totals.passed, totals.passed + totals.failed);

// The range's six totals. Under each, how it compares with the period before, measured on complete
// days only, and shown only when that period has history.
export function OverviewTotals({ current, compared, before }: { current: DayTotals; compared: Compared | null; before: string }) {
  const days = compared ? `${compared.span} complete ${compared.span === 1 ? "day" : "days"}` : "";
  const why = `The last ${days} against the ${days} before them. Today is left out, since it isn't over.`;
  const jobs = compared && compared.before.jobs > 0 ? compared : null;
  const reviews = compared && compared.before.reviews > 0 ? compared : null;
  const passedBefore = jobs ? rate(jobs.before) : null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-x-7 gap-y-5">
      <Total label="Jobs ran" value={current.jobs.toLocaleString()} under={jobs ? change(jobs.recent.jobs, jobs.before.jobs, before, true) : null} why={why} />
      <Total label="Passed" value={rate(current) ?? "-"} under={passedBefore ? `${passedBefore} ${before}` : null} why={why} />
      <Total label="Typical wait" value={formatDuration(current.typicalWaitMs)} under={jobs?.before.typicalWaitMs != null ? `${formatDuration(jobs.before.typicalWaitMs)} ${before}` : null} why={why} />
      <Total label="On your machines" value={hoursText(current.ownMachinesMs)} under={jobs ? change(jobs.recent.ownMachinesMs, jobs.before.ownMachinesMs, before, true) : null} why={why} />
      <Total label="Reviews" value={current.reviews.toLocaleString()} under={reviews ? change(reviews.recent.reviews, reviews.before.reviews, before, false) : null} why={why} />
      <Total label="Caught before merge" value={current.reviewsWithFindings.toLocaleString()} under={reviews ? change(reviews.recent.reviewsWithFindings, reviews.before.reviewsWithFindings, before, false) : null} why={why} />
    </div>
  );
}
