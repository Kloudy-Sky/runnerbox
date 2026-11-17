import type { DayTotals } from "@runnerbox/contracts";
import { addTotals } from "../../lib/addTotals.ts";
import { ChartLegend } from "./ChartLegend.tsx";
import { DayBars } from "./DayBars.tsx";
import type { MachineDays } from "./machineDays.ts";
import { percentText } from "./durationWords.ts";
import { OverviewSection } from "./OverviewSection.tsx";
import { RankedList } from "./RankedList.tsx";

const PASSED = "fill-foreground/90";
const FAILED = "fill-destructive";

// Jobs that passed and failed each day, and each machine's share of them.
export function JobsEachDay({ days, byMachine, range }: { days: ReadonlyArray<DayTotals>; byMachine: ReadonlyArray<MachineDays>; range: string }) {
  const total = addTotals(days);
  const machines = byMachine.map((machine) => ({ ...machine, totals: addTotals(machine.days) })).filter((machine) => machine.totals.jobs > 0);
  return (
    <OverviewSection title="Jobs each day" aside={`${total.jobs.toLocaleString()} ${range.toLowerCase()}`}>
      {total.jobs === 0 ? (
        <p className="text-muted-foreground">No jobs ran {range.toLowerCase()}.</p>
      ) : (
        <>
          <ChartLegend keys={[{ label: "Passed", mark: "box", className: "bg-foreground/90" }, { label: "Failed", mark: "box", className: "bg-destructive" }]} />
          <DayBars
            days={days.map((day) => day.day)}
            series={[
              { label: "Passed", fill: PASSED, values: days.map((day) => day.passed) },
              { label: "Failed", fill: FAILED, values: days.map((day) => day.failed) },
            ]}
            label="Jobs each day, passed and failed"
          />
        </>
      )}
      <RankedList
        heading="By machine"
        rows={machines
          .toSorted((a, b) => b.totals.jobs - a.totals.jobs)
          .map(({ environmentId, label, totals }) => {
            const passed = percentText(totals.passed, totals.passed + totals.failed);
            return { key: environmentId, label, value: `${totals.jobs.toLocaleString()} jobs${passed ? ` · ${passed} passed` : ""}` };
          })}
      />
    </OverviewSection>
  );
}
