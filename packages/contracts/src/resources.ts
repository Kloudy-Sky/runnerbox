import * as Schema from "effect/Schema";
import { JobRun } from "./history.ts";

const NullableNumber = Schema.NullOr(Schema.Number);
const NullableString = Schema.NullOr(Schema.String);

// A kind's container limits when a runner ran. `cpus` is whole CPUs; Docker's CPU percent counts
// 100 for each, so the CPU limit line is `cpus * 100`.
export const ContainerLimits = Schema.Struct({ memoryMiB: Schema.Number, cpus: Schema.Number });
export type ContainerLimits = typeof ContainerLimits.Type;

// Whether a job's container has readings, and why not when it hasn't.
export const ResourceCoverage = Schema.Literals(["sampled", "no_samples", "job_vm", "host", "not_ours", "no_runner"]);
export type ResourceCoverage = typeof ResourceCoverage.Type;

export const SentenceCase = Schema.Literals(["stopped_for_memory", "memory_limit", "cpu_limit", "vm_low", "nothing_unusual", "few_readings", "not_sampled"]);
export type SentenceCase = typeof SentenceCase.Type;

// One step placed in its job. `exact` is false for records synced before step start times were
// kept, whose offsets are added up from the steps' lengths.
export const PlacedStep = Schema.Struct({ name: Schema.String, conclusion: NullableString, offsetMs: NullableNumber, ms: NullableNumber, exact: Schema.Boolean });
export type PlacedStep = typeof PlacedStep.Type;

export const ResourcePoint = Schema.Struct({ offsetMs: Schema.Number, memMiB: Schema.Number, cpuPercent: Schema.Number });
export type ResourcePoint = typeof ResourcePoint.Type;

export const VmPoint = Schema.Struct({ offsetMs: Schema.Number, availableMiB: Schema.Number, totalMiB: Schema.Number });
export type VmPoint = typeof VmPoint.Type;

// One plain sentence about what the readings show, by rules on the server. `step` is named only
// when the evidence fell inside that step's own time.
export const ResourceSentence = Schema.Struct({ case: SentenceCase, text: Schema.String, step: NullableString });
export type ResourceSentence = typeof ResourceSentence.Type;

// One job attempt with its steps on its timeline, its container's memory and CPU, and the VM's
// free memory, all as offsets in ms from the job's start.
export const JobResources = Schema.Struct({
  job: JobRun,
  steps: Schema.Array(PlacedStep),
  coverage: ResourceCoverage,
  points: Schema.Array(ResourcePoint),
  vm: Schema.Array(VmPoint),
  limits: Schema.NullOr(ContainerLimits),
  // When its container was stopped for using too much memory, and the step that was running.
  stoppedForMemory: Schema.NullOr(Schema.Struct({ offsetMs: Schema.Number, step: NullableString })),
  sentence: Schema.NullOr(ResourceSentence),
});
export type JobResources = typeof JobResources.Type;
