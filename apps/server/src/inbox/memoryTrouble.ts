import type { InboxItem } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { isFailure, jobKey, jobName, startedMs } from "./jobs.ts";
import { classifyFailures, type InboxInput, type MachineCause, machineCauses } from "./rules.ts";

// Where a "needs you" failure ran out of memory: the install and kind most of its starved attempts
// ran on, how many there were, and the latest of them.
export type MemoryTrouble = { readonly install: string; readonly kind: string; readonly job: string; readonly failures: number; readonly last: JobRecord };

// Swap alone means the machine ran short, not out, and the fix's reason says "ran out".
const ranOut = (cause: MachineCause) => cause.kind === "memory" && cause.source !== "swap";

// The only items a machine cause, and so memory trouble, can be on.
export const isMachineFailure = (item: InboxItem) => item.kind === "failure" && item.verdict === "infra" && item.group === "needs_you";

// The item's memory trouble, counting only attempts that started after `since`. Undefined when
// the machine didn't run out of memory under it, or no runner event names where the job ran.
export function memoryTrouble(item: InboxItem, input: InboxInput, since: number): MemoryTrouble | undefined {
  if (!isMachineFailure(item)) return undefined;
  const shown = input.jobs.find((job) => job.jobId === item.evidence.attempts[0]?.jobId);
  if (!shown) return undefined;
  const starved = classifyFailures(input.jobs.filter((job) => jobKey(job) === jobKey(shown)), input)
    .filter((unit) => unit.verdict === "infra")
    .flatMap((unit) => unit.attempts)
    .filter((job) => job.runner !== null && isFailure(job) && startedMs(job) > since && machineCauses(job, input).some(ranOut))
    .flatMap((job) => {
      const runner = input.events.find((event) => event.event === "runner" && event.runner === job.runner);
      return runner?.runnerType ? [{ job, install: runner.install, kind: runner.runnerType }] : [];
    });
  const [most] = [...Map.groupBy(starved, ({ install, kind }) => `${install}\0${kind}`).values()].toSorted((a, b) => b.length - a.length);
  if (!most) return undefined;
  const last = most.map(({ job }) => job).toSorted((a, b) => startedMs(a) - startedMs(b)).at(-1)!;
  return { install: most[0]!.install, kind: most[0]!.kind, job: jobName(shown), failures: most.length, last };
}
