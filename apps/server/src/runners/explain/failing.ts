import { FAILING_STREAK, failedRunner } from "../../inbox/slots.ts";
import type { ExplainInput, RunnerEvent } from "./input.ts";

// The kinds with a runner whose last few all failed, by the inbox's own rule, so the page and the
// inbox's failing-runner item always agree.
export function failingKinds(events: ExplainInput["events"]) {
  const runners = events.filter((event): event is RunnerEvent => event.event === "runner");
  const bySlot = Map.groupBy(runners, (event) => `${event.runnerType ?? ""}\0${event.slot}`);
  const failing = [...bySlot.values()].filter((own) => {
    const sorted = own.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    return sorted.length - (sorted.findLastIndex((event) => !failedRunner(event)) + 1) >= FAILING_STREAK;
  });
  return new Set(failing.flatMap((own) => (own[0]?.runnerType ? [own[0].runnerType] : [])));
}
