import type { DayTotals } from "@runnerbox/contracts";

// One machine's days in the range, for a section's list by machine.
export type MachineDays = { readonly environmentId: string; readonly label: string; readonly days: ReadonlyArray<DayTotals> };
