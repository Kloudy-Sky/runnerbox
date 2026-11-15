import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { coveredMs, peakOverlap, type Span, union } from "./intervals.ts";
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
  // Clock time while any of the jobs waited (two waiting at once count once), and how much of
  // that a memory wait or full slots covered.
  waitedMs: number;
  memoryMs: number;
  busyMs: number;
  // The most jobs on the label waiting for a runner at once.
  peak: number;
  typicalMs: number | null;
  // Which machine the samples show low on memory while the label's jobs ran, if any.
  tight: "VM" | "host" | null;
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

// Every kind an install is known to have, live or from its tagged runners.
const kindsOf = (install: string, input: InboxInput) =>
  new Set([
    ...input.installs.filter((each) => each.install === install).flatMap((each) => each.kinds.map((kind) => kind.name)),
    ...input.events.flatMap((event) => (event.install === install && event.event === "runner" && present(event.runnerType) ? [event.runnerType] : [])),
  ]);

// A memory wait held up `served` kinds when it was tagged with one of them. An `up` from before
// kinds (#15) tagged nothing and ran one kind per install, so an untagged wait counts when its
// install has only ever had one kind and that kind is served.
function heldUp(event: MemoryWait, served: ReadonlyMap<string, number>, input: InboxInput) {
  if (present(event.runnerType)) return served.has(kindKey(event.install, event.runnerType));
  const kinds = [...kindsOf(event.install, input)];
  return kinds.length === 1 && served.has(kindKey(event.install, kinds[0]!));
}

// The machine the samples show short of memory while any of `jobs` ran: the VM first, since a
// kind's slots draw on it.
function tightOn(jobs: readonly JobRecord[], input: InboxInput): WaitCause["tight"] {
  const sources = new Set(jobs.flatMap((job) => machineCauses(job, { machine: input.machine, events: [] }).map((cause) => cause.source)));
  return sources.has("vm_memory") || sources.has("swap") ? "VM" : sources.has("host_memory") ? "host" : null;
}

export function waitCause(label: string, waiting: readonly JobRecord[], input: InboxInput): WaitCause {
  const served = kindsServing(label, input);
  const windows = union(waiting.map((job) => ({ start: Date.parse(job.createdAt), end: Date.parse(at(job)) })));
  const overlaps = (span: Span) => windows.some((window) => span.start < window.end && span.end > window.start);
  const waits = input.events.filter(
    (event): event is MemoryWait =>
      event.event === "memory_wait" &&
      heldUp(event, served, input) &&
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
    tight: tightOn(ran.filter((job) => overlaps({ start: Date.parse(job.startedAt!), end: Date.parse(job.completedAt!) })), input),
    waits,
    cause: share(memoryMs) >= MEMORY_SHARE ? "memory" : slots && share(busyMs) >= BUSY_SHARE ? "slots" : "unknown",
  };
}
