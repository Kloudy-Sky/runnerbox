import type { ContainerLimits, PlacedStep, ResourceCoverage, ResourcePoint, ResourceSentence, VmPoint } from "@runnerbox/contracts";
import { gib, plural } from "../inbox/jobs.ts";
import { LOW_MEMORY_SHARE } from "../inbox/rules.ts";
import { stepAt } from "./placedSteps.ts";

// A reading at this share of the memory limit or more counts as reaching it: the kernel reclaims
// cache near the limit, so a job pressing on it reads just under.
const MEMORY_AT_LIMIT = 0.95;
// A reading at this share of the CPU limit counts as at it, since Docker's figure jitters.
const CPU_AT_LIMIT = 0.9;
// CPU is "at the limit for most of" a stretch when this share of its readings are.
const CPU_MOST = 2 / 3;
// A step must be this share of the job before its CPU is worth a sentence.
const CPU_STEP_SHARE = 0.25;
// Fewer readings than this are too few to say a job was ordinary, or a step was CPU-bound.
const MIN_READINGS = 3;
// Readings must span this share of the job before "nothing unusual" can be said of all of it.
const COVERED_SHARE = 0.8;
// The job stayed "well under" its limit below this share of it.
const WELL_UNDER = 0.8;

export type SentenceInput = {
  coverage: ResourceCoverage;
  steps: readonly PlacedStep[];
  points: readonly ResourcePoint[];
  vm: readonly VmPoint[];
  limits: ContainerLimits | null;
  stoppedForMemory: { offsetMs: number; step: string | null } | null;
  durationMs: number | null;
};

const NOT_SAMPLED: Partial<Record<ResourceCoverage, string>> = {
  job_vm: "This job ran in a VM of its own, which isn't sampled yet.",
  host: "Jobs on this machine's own OS aren't sampled.",
  not_ours: "This job ran on GitHub's machines or another machine's runners, so there are no readings of it.",
  no_samples: "No readings were taken while this job ran.",
};

const cpus = (count: number) => (count === 1 ? "1 CPU" : `${count} CPUs`);
const atLimit = (points: readonly ResourcePoint[], limit: ContainerLimits) =>
  points.filter((point) => point.cpuPercent >= limit.cpus * 100 * CPU_AT_LIMIT).length >= points.length * CPU_MOST;
const within = (points: readonly ResourcePoint[], step: PlacedStep) =>
  points.filter((point) => step.offsetMs !== null && step.ms !== null && point.offsetMs >= step.offsetMs && point.offsetMs <= step.offsetMs + step.ms);

// What a job's readings show, in one sentence, by the first case that holds. A step is named only
// when the evidence fell inside that step's own time. Readings are a few seconds apart, so a peak
// between two is missed, and "the highest reading" says so.
export function resourceSentence(input: SentenceInput): ResourceSentence | null {
  const say = (kind: ResourceSentence["case"], text: string, step: string | null = null): ResourceSentence => ({ case: kind, text, step });
  const { points, limits, steps } = input;
  if (input.coverage === "no_runner") return null;
  // The runner's event says it was stopped, with or without readings of it.
  if (input.stoppedForMemory) {
    const { step } = input.stoppedForMemory;
    const limit = limits ? `, at its ${gib(limits.memoryMiB)} limit` : "";
    return say("stopped_for_memory", `The container was stopped for using too much memory${step ? ` during ${step}` : " while this job ran"}${limit}.`, step);
  }
  const unsampled = NOT_SAMPLED[input.coverage];
  if (unsampled) return say("not_sampled", unsampled);
  const peak = Math.max(...points.map((point) => point.memMiB));
  if (limits) {
    const reached = points.find((point) => point.memMiB >= limits.memoryMiB * MEMORY_AT_LIMIT);
    if (reached) {
      const step = stepAt(steps, reached.offsetMs)?.name ?? null;
      return say("memory_limit", `Memory reached this kind's ${gib(limits.memoryMiB)} limit${step ? ` in ${step}` : " while this job ran"}.`, step);
    }
    const job = input.durationMs ?? 0;
    const bound = steps.find((step) => step.exact && (step.ms ?? 0) >= job * CPU_STEP_SHARE && within(points, step).length >= MIN_READINGS && atLimit(within(points, step), limits));
    if (bound) return say("cpu_limit", `CPU was at this kind's limit of ${cpus(limits.cpus)} for most of ${bound.name}, so that step was held back by CPU.`, bound.name);
    if (points.length >= MIN_READINGS && atLimit(points, limits)) return say("cpu_limit", `CPU was at this kind's limit of ${cpus(limits.cpus)} for most of this job, so it was held back by CPU.`);
  }
  const lowest = input.vm.reduce<VmPoint | undefined>((low, point) => (low === undefined || point.availableMiB < low.availableMiB ? point : low), undefined);
  if (lowest && lowest.availableMiB < lowest.totalMiB * LOW_MEMORY_SHARE && (!limits || peak < limits.memoryMiB * WELL_UNDER)) {
    return say("vm_low", `The VM ran low on memory while this job ran${limits ? ", though the job itself stayed well under its limit" : ""}.`);
  }
  if (points.length < MIN_READINGS) return say("few_readings", `Only ${plural(points.length, "reading was", "readings were")} taken while this job ran, too few to say more.`);
  // Readings come at a steady pace, so the span they cover is first to last plus one gap.
  const gap = (points.at(-1)!.offsetMs - points[0]!.offsetMs) / (points.length - 1);
  const covered = points.at(-1)!.offsetMs - points[0]!.offsetMs + gap;
  if (input.durationMs !== null && covered < input.durationMs * COVERED_SHARE) {
    return say("few_readings", "The readings cover only part of this job, too little to say more.");
  }
  return say(
    "nothing_unusual",
    limits
      ? `Nothing unusual: the highest reading was ${gib(peak)} of its ${gib(limits.memoryMiB)} memory limit, and CPU stayed under its limit of ${cpus(limits.cpus)}.`
      : `Nothing unusual: the highest memory reading was ${gib(peak)}.`,
  );
}
