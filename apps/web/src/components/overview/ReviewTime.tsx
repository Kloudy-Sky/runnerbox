import type { DayTotals } from "@runnerbox/contracts";
import { addTotals } from "../../lib/addTotals.ts";
import { usdText } from "./durationWords.ts";
import { OverviewSection } from "./OverviewSection.tsx";
import { RankedList } from "./RankedList.tsx";
import { TimedDays } from "./TimedDays.tsx";

// How long a typical review took each day, against the usual, and what reviews cost on the owner's
// Claude account.
export function ReviewTime({ days, usual, range }: { days: ReadonlyArray<DayTotals>; usual: number | null; range: string }) {
  const total = addTotals(days);
  return (
    <OverviewSection title="Time per review" aside={range.toLowerCase()}>
      <TimedDays days={days.map((day) => day.day)} values={days.map((day) => day.typicalReviewMs)} usual={usual} name="Typical review" label="Typical time a review took each day" empty={`No reviews finished ${range.toLowerCase()}.`} />
      <RankedList
        heading="On your Claude account"
        rows={[
          { key: "range", label: range, value: usdText(total.reviewCostUsd) },
          ...(total.reviews > 0 ? [{ key: "each", label: "Per review", value: usdText(total.reviewCostUsd / total.reviews) }] : []),
        ]}
      />
    </OverviewSection>
  );
}
