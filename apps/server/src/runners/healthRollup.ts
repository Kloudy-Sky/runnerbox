import { HealthDay } from "@runnerbox/contracts";
import * as Schema from "effect/Schema";
import { dayKey, dayStart } from "./hostDays.ts";
import type { InstallDays } from "./machineDays.ts";

// Each install's finished days, in `.server/health.json`, so a day outlives its minute samples.
// `up` keeps 50 MB of samples per install (10 MB files, 4 rotated copies), about a kilobyte a
// minute with a few containers listed, which is only a few weeks on a busy VM.
export const RollupFile = Schema.Struct({ v: Schema.Literal(1), installs: Schema.Record(Schema.String, Schema.Array(HealthDay)) });
export type Rollup = typeof RollupFile.Type["installs"];

// As long as the longest range anyone can ask for.
export const KEPT_DAYS = 90;

// Folds freshly computed days into the stored ones. Today isn't finished, so it's never kept. A
// day the logs still hold whole replaces the stored one, since late events can change it. A day
// the logs hold only part of, having rotated out its start, is kept only when nothing was stored:
// that's an install's first day, or one the server wasn't running to fold in time.
export function foldDays(stored: Rollup, computed: readonly InstallDays[], now: number): Rollup {
  const today = dayKey(now);
  const oldest = dayKey(dayStart(now, -KEPT_DAYS));
  const installs: Record<string, ReadonlyArray<HealthDay>> = { ...stored };
  for (const { install, coveredFrom, days } of computed) {
    const kept = new Map((installs[install] ?? []).map((day) => [day.day, day]));
    // Days after the one holding the oldest record are whole in the logs.
    const firstWhole = dayKey(dayStart(coveredFrom, 1));
    for (const day of days) {
      if (day.day === today) continue;
      if (day.day >= firstWhole || !kept.has(day.day)) kept.set(day.day, day);
    }
    installs[install] = [...kept.values()].toSorted((a, b) => a.day.localeCompare(b.day));
  }
  return Object.fromEntries(Object.entries(installs).map(([install, days]) => [install, days.filter((day) => day.day >= oldest)]));
}
