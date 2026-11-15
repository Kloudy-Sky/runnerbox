import type { Bottleneck, KindUsage, KindUsageReport, LauncherEvent } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { coveredMs } from "../inbox/intervals.ts";
import { at, durationMs, median, plural, present, STARVED_AFTER_MS } from "../inbox/jobs.ts";
import type { InboxInput } from "../inbox/rules.ts";
import { allSlotsBusyMs, kindKey, kindsServing, type WaitCause, waitCause } from "../inbox/waitCause.ts";
import { estimateCost, PRICES_READ_ON, PRICES_SOURCE } from "./hostedRates.ts";

type RunnerEvent = Extract<LauncherEvent, { event: "runner" }>;
type Kind = { install: string; kind: string; label: string | undefined; runsIn: "container" | "job_vm" | "host" | undefined };

// Every kind known, live from `up`'s state or from its tagged runners, with the label it serves.
function knownKinds(input: InboxInput): Kind[] {
  const kinds = new Map<string, Kind>();
  for (const install of input.installs) {
    for (const kind of install.kinds) kinds.set(kindKey(install.install, kind.name), { install: install.install, kind: kind.name, label: kind.label, runsIn: kind.runsIn });
  }
  // A kind gone from the live state is still known by its runners, and labelled by any of them
  // that ran a job: one that was released unused says nothing about its label.
  const runners = input.events.filter((event): event is RunnerEvent & { runnerType: string } => event.event === "runner" && present(event.runnerType));
  for (const [key, events] of Map.groupBy(runners, (event) => kindKey(event.install, event.runnerType))) {
    if (kinds.has(key)) continue;
    const ran = input.jobs.find((job) => events.some((event) => event.runner === job.runner));
    kinds.set(key, { install: events[0]!.install, kind: events[0]!.runnerType, label: ran ? runnerType(ran) : undefined, runsIn: undefined });
  }
  return [...kinds.values()];
}

// How long a job waited for a runner: until it started, or for one that never got a runner and
// wasn't just cancelled at once, until it ended.
function waitMs(job: JobRecord) {
  if (job.runner !== null) return elapsedMs(job.createdAt, job.startedAt);
  return (elapsedMs(job.createdAt, at(job)) ?? 0) >= STARVED_AFTER_MS ? elapsedMs(job.createdAt, at(job)) : null;
}

// The page names a bottleneck only when the inbox's own rule finds one, so the two never disagree.
function bottleneckOf(cause: WaitCause): Bottleneck | null {
  const kinds = cause.kinds.join(" and ");
  const runners = `the ${kinds} runners`;
  if (cause.cause === "slots" && cause.slots) {
    const busy = cause.slots === 1 ? `The ${kinds} runner is the bottleneck: it was` : `The ${kinds} runners are the bottleneck: ${cause.slots === 2 ? "both" : `all ${cause.slots}`} were`;
    return { cause: "slots", text: `${busy} busy while jobs waited, with ${plural(cause.peak, "job")} waiting at once.` };
  }
  if (cause.cause === "memory") return { cause: "memory", text: `Jobs for ${runners} waited for free memory on the machine, not for a free runner.` };
  return null;
}

// Each kind over the last `days`, across every repository: its slots, how busy they were, how long
// jobs waited for one, why when the evidence says, and what its job minutes would cost hosted.
export function kindUsage(input: InboxInput, days: number): KindUsageReport {
  const since = input.now - days * 24 * 60 * 60_000;
  const range = { start: since, end: input.now };
  const inRange = input.jobs.filter((job) => Date.parse(job.createdAt) >= since);
  const kinds = knownKinds(input).flatMap((kind): KindUsage[] => {
    if (kind.label === undefined) return [];
    const label = kind.label;
    const own = input.events.filter((event): event is RunnerEvent => event.event === "runner" && event.install === kind.install && event.runnerType === kind.kind);
    const runners = new Set(own.map((event) => event.runner));
    const onLabel = inRange.filter((job) => runnerType(job) === label);
    const serving = kindsServing(label, input);
    // Jobs this kind ran, by its runners' names. With none recorded, every job on its label is its
    // only when no other kind serves that label, so no job is counted twice.
    const byLabel = runners.size === 0 && serving.size === 1;
    const ran = onLabel.filter((job): job is JobRecord & { runner: string; startedAt: string } => job.runner !== null && job.startedAt !== null && (byLabel || runners.has(job.runner)));
    const running = ran.map((job) => ({ start: Date.parse(job.startedAt), end: job.completedAt ? Date.parse(job.completedAt) : input.now }));
    const slots = serving.get(kindKey(kind.install, kind.kind)) ?? null;
    const waits = onLabel.map(waitMs).filter(present);
    const longWaits = onLabel.filter((job) => (waitMs(job) ?? 0) >= STARVED_AFTER_MS);
    const limits = own.findLast((event) => event.limits)?.limits ?? null;
    const rangeMs = range.end - range.start;
    return [
      {
        install: kind.install,
        kind: kind.kind,
        label,
        slots,
        limits,
        jobs: ran.length,
        runnerMs: ran.reduce((sum, job) => sum + (durationMs(job) ?? 0), 0),
        allBusyShare: slots ? allSlotsBusyMs(range, running, slots) / rangeMs : null,
        anyBusyShare: coveredMs(range, running) / rangeMs,
        waitTypicalMs: median(waits),
        waitLongestMs: waits.length > 0 ? Math.max(...waits) : null,
        bottleneck: longWaits.length > 0 ? bottleneckOf(waitCause(label, longWaits, input)) : null,
        cost: estimateCost(ran.map(durationMs).filter(present), { runsIn: kind.runsIn ?? "container", cpus: limits?.cpus ?? null }),
      },
    ];
  });
  const priced = kinds.flatMap((kind) => (kind.cost ? [kind.cost] : []));
  return {
    since: new Date(since).toISOString(),
    until: new Date(input.now).toISOString(),
    kinds,
    totalCost: priced.length === 0 ? null : { usd: Math.round(priced.reduce((sum, cost) => sum + cost.usd, 0) * 100) / 100, minutes: priced.reduce((sum, cost) => sum + cost.minutes, 0) },
    pricesReadOn: PRICES_READ_ON,
    pricesSource: PRICES_SOURCE,
  };
}
