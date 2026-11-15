import type { PlacedStep } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";

// Each step at its offset from the job's start: from its own start time when the record has it,
// or else added up from the lengths of the steps before it.
export function placeSteps(job: JobRecord): PlacedStep[] {
  const start = job.startedAt ? Date.parse(job.startedAt) : null;
  let elapsed = 0;
  return job.steps.map((step) => {
    const own = step.startedAt;
    const offsetMs = start === null ? null : own !== undefined ? Date.parse(own) - start : elapsed;
    const exact = start !== null && own !== undefined;
    elapsed += step.ms ?? 0;
    return { name: step.name, conclusion: step.conclusion, offsetMs, ms: step.ms, exact };
  });
}

// The step whose own placed time holds `offsetMs`. Steps placed from lengths alone aren't trusted
// to hold anything, so they're never named.
export function stepAt(steps: readonly PlacedStep[], offsetMs: number) {
  return steps.find((step) => step.exact && step.offsetMs !== null && step.ms !== null && offsetMs >= step.offsetMs && offsetMs <= step.offsetMs + step.ms);
}
