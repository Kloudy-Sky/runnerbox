import type { InstallState, JobResources, LauncherEvent, ResourceCoverage, ResourcePoint, Verdict, VmPoint } from "@runnerbox/contracts";
import { containerName } from "runnerbox/src/launcher/docker-command.ts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { InstallContainerSample, InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import { OUT_OF_MEMORY_EXIT } from "../inbox/rules.ts";
import { toJobRun } from "./jobRun.ts";
import { placeSteps, stepAt } from "./placedSteps.ts";
import { resourceSentence } from "./resourceSentence.ts";

type RunnerEvent = Extract<LauncherEvent, { event: "runner" }>;

export type ResourceInput = {
  now: number;
  job: JobRecord;
  verdict: Verdict | null;
  events: readonly LauncherEvent[];
  installs: readonly InstallState[];
  // Each sorted by time.
  samples: readonly InstallSample[];
  containerSamples: readonly InstallContainerSample[];
};

// The container that ran `job`, as install, kind and slot. The runner's event names all three. A
// job still running has no event yet, so its slot in the live state stands in.
function containerOf(job: JobRecord, input: ResourceInput) {
  const event = input.events.find((each): each is RunnerEvent => each.event === "runner" && each.runner === job.runner);
  if (event) {
    const kind = event.runnerType ?? onlyKindNamed(event.install, job.runner!, input.installs);
    const end = Date.parse(event.startedAt) + event.durationMs;
    return { install: event.install, kind, slot: event.slot, start: Date.parse(event.startedAt), end, event };
  }
  for (const install of input.installs) {
    for (const kind of install.kinds) {
      const slot = kind.slots.find((each) => each.runner === job.runner);
      if (slot) return { install: install.install, kind: kind.name, slot: slot.slot, start: Date.parse(slot.since), end: input.now, event: undefined };
    }
  }
  return undefined;
}

// Runner names are `<install>-<kind>-<slot>-<epoch>`. An event from before kinds were recorded has
// no kind, so it's taken from the name, and only when exactly one of the install's kinds fits.
function onlyKindNamed(install: string, runner: string, installs: readonly InstallState[]) {
  const kinds = installs.find((each) => each.install === install)?.kinds.filter((kind) => runner.startsWith(`${install}-${kind.name}-`)) ?? [];
  return kinds.length === 1 ? kinds[0]!.name : undefined;
}

// Whether any install's runners are named like this one, so it's ours even without an event.
const named = (runner: string, input: ResourceInput) =>
  [...input.installs.map((each) => each.install), ...input.events.map((each) => each.install)].some((install) => runner.startsWith(`${install}-`));

// One job attempt with its container's readings. They're joined through the runner's event, with
// no slack: the same container name comes back for the slot's next job, so only the time both
// the job and its container ran counts.
export function jobResources(input: ResourceInput): JobResources {
  const { job } = input;
  const steps = placeSteps(job);
  const empty = { job: toJobRun(job, input.verdict), steps, points: [], vm: [], limits: null, stoppedForMemory: null };
  const without = (coverage: ResourceCoverage): JobResources => ({ ...empty, coverage, sentence: resourceSentence({ ...empty, coverage, durationMs: null }) });
  if (job.runner === null || job.startedAt === null) return without("no_runner");
  const container = containerOf(job, input);
  if (!container) return without(named(job.runner, input) ? "no_samples" : "not_ours");
  const runsIn = input.installs.find((each) => each.install === container.install)?.kinds.find((kind) => kind.name === container.kind)?.runsIn;
  if (runsIn === "job_vm" || runsIn === "host") return without(runsIn);

  const jobStart = Date.parse(job.startedAt);
  const jobEnd = job.completedAt ? Date.parse(job.completedAt) : input.now;
  const from = Math.max(jobStart, container.start);
  const to = Math.min(jobEnd, container.end);
  const name = container.kind === undefined ? undefined : containerName(container.install, container.kind, container.slot);
  const inWindow = (time: string) => Date.parse(time) >= from && Date.parse(time) <= to;
  const own = [...input.samples, ...input.containerSamples].filter(({ install, sample }) => install === container.install && inWindow(sample.time));
  const byTime = new Map<number, ResourcePoint>();
  for (const { sample } of own) {
    const reading = sample.containers?.find((each) => each.name === name);
    if (reading) byTime.set(Date.parse(sample.time), { offsetMs: Date.parse(sample.time) - jobStart, memMiB: reading.memMiB, cpuPercent: reading.cpuPercent });
  }
  const points = [...byTime.values()].toSorted((a, b) => a.offsetMs - b.offsetMs);
  const vm: VmPoint[] = input.samples.flatMap(({ install, sample }) =>
    install === container.install && sample.vm && Date.parse(sample.time) >= jobStart && Date.parse(sample.time) <= jobEnd
      ? [{ offsetMs: Date.parse(sample.time) - jobStart, availableMiB: sample.vm.availableMiB, totalMiB: sample.vm.totalMiB }]
      : [],
  );
  const event = container.event;
  const stopAt = event && event.exitCode === OUT_OF_MEMORY_EXIT ? Math.min(container.end, jobEnd) - jobStart : null;
  const stoppedForMemory = stopAt === null ? null : { offsetMs: stopAt, step: stepAt(steps, stopAt)?.name ?? null };
  const found = {
    ...empty,
    coverage: points.length > 0 ? ("sampled" as const) : ("no_samples" as const),
    points,
    vm,
    limits: event?.limits ?? null,
    stoppedForMemory,
  };
  return { ...found, sentence: resourceSentence({ ...found, durationMs: jobEnd - jobStart }) };
}
