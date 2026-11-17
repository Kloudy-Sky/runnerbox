import type { DayTotals } from "@runnerbox/contracts";
import { addTotals } from "../../lib/addTotals.ts";
import { formatDuration } from "../../lib/format.ts";
import type { MachineDays } from "./machineDays.ts";
import { OverviewSection } from "./OverviewSection.tsx";
import { RankedList } from "./RankedList.tsx";
import { TimedDays } from "./TimedDays.tsx";

// How long a typical job waited for a runner each day, against the usual wait over this period and
// the one before, and each machine's typical wait.
export function WaitEachDay({ days, usual, byMachine, range }: { days: ReadonlyArray<DayTotals>; usual: number | null; byMachine: ReadonlyArray<MachineDays>; range: string }) {
  const machines = byMachine.map((machine) => ({ ...machine, wait: addTotals(machine.days).typicalWaitMs })).filter((machine) => machine.wait !== null);
  return (
    <OverviewSection title="Wait for a runner" aside={range.toLowerCase()}>
      <TimedDays days={days.map((day) => day.day)} values={days.map((day) => day.typicalWaitMs)} usual={usual} name="Typical job" label="Typical wait for a runner each day" empty={`No jobs ran ${range.toLowerCase()}.`} />
      <RankedList heading="By machine" rows={machines.toSorted((a, b) => (b.wait ?? 0) - (a.wait ?? 0)).map((machine) => ({ key: machine.environmentId, label: machine.label, value: formatDuration(machine.wait) }))} />
    </OverviewSection>
  );
}
