import type { InboxItem, LauncherEvent } from "@runnerbox/contracts";
import { ADVICE } from "./advice.ts";
import { listed, plural } from "./jobs.ts";
import { exitText, type InboxInput, OUT_OF_MEMORY_EXIT } from "./rules.ts";

// Consecutive failed runners at the end of a slot's history before it counts as failing.
export const FAILING_STREAK = 3;
// Docker's own exit code when it can't create or start the container.
const DOCKER_COULD_NOT_START = 125;

type RunnerEvent = Extract<LauncherEvent, { event: "runner" }>;
export const failedRunner = (event: RunnerEvent) => !event.released && event.exitCode !== 0;

export const whyFor = (exitCode: number | null) =>
  exitCode === DOCKER_COULD_NOT_START
    ? "Docker couldn't start the container. That usually means the image, or the runtime it needs, is missing or broken."
    : exitCode === OUT_OF_MEMORY_EXIT
      ? "The container was stopped for using too much memory before it could finish."
      : exitCode === null
        ? "The connection to the VM dropped."
        : "The container stopped with an error before it could take a job.";

const actionFor = (exitCode: number | null) =>
  exitCode === OUT_OF_MEMORY_EXIT ? ADVICE.memory : exitCode === null ? ADVICE.connection : ADVICE.container;

// Runner slots whose last few runners all failed. One kind on one install is one item, however
// many of its slots fail, with each slot in the breakdown.
export function slotItems(input: InboxInput): InboxItem[] {
  const runners = input.events.filter((event): event is RunnerEvent => event.event === "runner");
  const bySlot = Map.groupBy(runners, (event) => `${event.install}\0${event.runnerType ?? "-"}\0${event.slot}`);
  const failing = [...bySlot.values()].flatMap((events) => {
    const sorted = events.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const streak = sorted.slice(sorted.findLastIndex((event) => !failedRunner(event)) + 1);
    return streak.length >= FAILING_STREAK ? [streak] : [];
  });
  const byKind = Map.groupBy(failing, (streak) => `${streak[0]!.install}\0${streak[0]!.runnerType ?? "default"}`);
  return [...byKind.values()].map((streaks) => {
    const last = streaks.flat().toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).at(-1)!;
    const kind = last.runnerType ?? "default";
    const codes = [...new Set(streaks.flat().map((event) => event.exitCode))];
    const slots = streaks.map((streak) => streak[0]!.slot).toSorted((a, b) => a - b);
    const backingOff = input.installs
      .find((install) => install.install === last.install)
      ?.kinds.find((candidate) => candidate.name === last.runnerType)
      ?.slots.some((slot) => slots.includes(slot.slot) && slot.phase === "backoff");
    const runnersFailed = streaks.reduce((sum, streak) => sum + streak.length, 0);
    // The owner reads runners, not slots: "The docker kind's runner 1 has failed to start 4 times
    // in a row (exit 125)." Only exit 125 means the container never started; any other stop came
    // after it started, before it took a job.
    const which = slots.length === 1 ? `The ${kind} kind's runner ${slots[0]} has` : `The ${kind} kind's runners ${listed(slots.map(String))} have`;
    const how = listed(codes.map((code) => (code === null ? "a lost connection" : `exit ${code}`)));
    return {
      id: `failing_slot:${last.install}:${kind}`,
      kind: "failing_slot",
      group: "needs_you",
      quiet: null,
      verdict: null,
      repo: null,
      install: last.install,
      title: `The ${kind} runners keep failing before they take a job`,
      happened: `${which} ${codes.every((code) => code === DOCKER_COULD_NOT_START) ? "failed to start" : "stopped before taking a job"} ${plural(runnersFailed, "time")} in a row (${how}).${backingOff ? " Runnerbox is waiting before it tries again." : ""}`,
      why: whyFor(codes[0] ?? null),
      action: actionFor(codes[0] ?? null),
      at: new Date(Date.parse(last.startedAt) + last.durationMs).toISOString(),
      evidence: {
        steps: [],
        attempts: [],
        machine: null,
        launcher: streaks.flat(),
        durations: [],
        reasons: codes.map((code) => exitText(code)),
        breakdown: streaks.map((streak) => ({ label: `runner ${streak[0]!.slot}`, count: streak.length, detail: `failed in a row` })),
      },
    } satisfies InboxItem;
  });
}
