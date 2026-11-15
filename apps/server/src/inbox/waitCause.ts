import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { coveredMs, peakOverlap, type Span } from "./intervals.ts";
import { at, durationMs, median, present } from "./jobs.ts";
import { type InboxInput, machineCauses } from "./rules.ts";

// Memory waits explain a wait only when they cover at least this share of the time jobs waited.
const MEMORY_SHARE = 0.25;
// A kind counts as busy the whole time when all its slots ran jobs for this share of the wait.
const BUSY_SHARE = 0.9;

type MemoryWait = Extract<LauncherEvent, { event: "memory_wait" }>;
type KindRunner = Extract<LauncherEvent, { event: "runner" }> & { runnerType: string };

// Why jobs on one label waited for a runner, judged only by the kinds that serve that label: a
// memory wait on another kind can't have held these jobs back.
export type WaitCause = {
  label: string;
  // The names of the kinds serving the label, empty when the logs don't say which.
  kinds: string[];
  // Their slots together, or null when unknown.
  slots: number | null;
  // Summed over the jobs: how long they waited, and how much of that a memory wait or full slots covered.
  waitedMs: number;
  memoryMs: number;
  busyMs: number;
  // The most jobs on the label waiting for a runner at once.
  peak: number;
  typicalMs: number | null;
  // The samples show the machine low on memory while the label's jobs ran.
  tight: boolean;
  waits: MemoryWait[];
  cause: "memory" | "slots" | "unknown";
};

const kindKey = (install: string, name: string) => `${install}\0${name}`;

// Each kind serving `label`, by install and name, with its slot count: live from `up`'s state, or
// else the slots its runners were recorded on.
function kindsServing(label: string, input: InboxInput) {
  const slots = new Map<string, number>();
  for (const install of input.installs) {
    for (const kind of install.kinds) if (kind.label === label) slots.set(kindKey(install.install, kind.name), kind.slots.length);
  }
  const onLabel = new Set(input.jobs.filter((job) => job.runner !== null && runnerType(job) === label).map((job) => job.runner));
  const runners = input.events.filter((event): event is KindRunner => event.event === "runner" && present(event.runnerType));
  const byKind = Map.groupBy(runners, (event) => kindKey(event.install, event.runnerType));
  for (const [key, events] of byKind) {
    if (!slots.has(key) && events.some((event) => onLabel.has(event.runner))) slots.set(key, new Set(events.map((event) => event.slot)).size);
  }
  return slots;
}

export function waitCause(label: string, waiting: readonly JobRecord[], input: InboxInput): WaitCause {
  const served = kindsServing(label, input);
  const windows: Span[] = waiting.map((job) => ({ start: Date.parse(job.createdAt), end: Date.parse(at(job)) }));
  const overlaps = (span: Span) => windows.some((window) => span.start < window.end && span.end > window.start);
  const waits = input.events.filter(
    (event): event is MemoryWait =>
      event.event === "memory_wait" &&
      present(event.runnerType) &&
      served.has(kindKey(event.install, event.runnerType)) &&
      overlaps({ start: Date.parse(event.startedAt), end: Date.parse(event.startedAt) + event.durationMs }),
  );
  const waitSpans = waits.map((event) => ({ start: Date.parse(event.startedAt), end: Date.parse(event.startedAt) + event.durationMs }));
  const onLabel = input.jobs.filter((job) => runnerType(job) === label);
  const ran = onLabel.filter((job) => job.runner !== null && present(job.startedAt) && present(job.completedAt));
  const running = ran.map((job) => ({ start: Date.parse(job.startedAt!), end: Date.parse(job.completedAt!) }));
  const queued = onLabel.map((job) => ({ start: Date.parse(job.createdAt), end: Date.parse(job.runner !== null && job.startedAt ? job.startedAt : at(job)) }));
  const slots = served.size === 0 ? null : [...served.values()].reduce((sum, count) => sum + count, 0);
  const sum = (each: (window: Span) => number) => windows.reduce((total, window) => total + each(window), 0);
  const waitedMs = sum((window) => window.end - window.start);
  const memoryMs = sum((window) => coveredMs(window, waitSpans));
  const busyMs = slots ? sum((window) => coveredMs(window, running, slots)) : 0;
  const share = (ms: number) => (waitedMs > 0 ? ms / waitedMs : 0);
  return {
    label,
    kinds: [...new Set([...served.keys()].map((key) => key.split("\0")[1]!))].toSorted(),
    slots,
    waitedMs,
    memoryMs,
    busyMs,
    peak: peakOverlap(windows, queued),
    typicalMs: median(ran.filter((job) => job.conclusion === "success").map(durationMs).filter(present)),
    tight: ran.some(
      (job) => overlaps({ start: Date.parse(job.startedAt!), end: Date.parse(job.completedAt!) }) && machineCauses(job, { machine: input.machine, events: [] }).length > 0,
    ),
    waits,
    cause: share(memoryMs) >= MEMORY_SHARE ? "memory" : slots && share(busyMs) >= BUSY_SHARE ? "slots" : "unknown",
  };
}
