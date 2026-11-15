import type { InstallState, LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { InstallContainerSample, InstallSample } from "runnerbox/src/tracking/sample-log.ts";

// What the rules read about one install: its live state, what `up` recorded in the window, the job
// log (matched to its runners by name) and its recent samples.
export type ExplainInput = {
  readonly now: number;
  readonly install: InstallState;
  readonly events: ReadonlyArray<LauncherEvent>;
  readonly jobs: ReadonlyArray<JobRecord>;
  readonly samples: ReadonlyArray<InstallSample>;
  readonly containerSamples: ReadonlyArray<InstallContainerSample>;
};

export type RunnerEvent = Extract<LauncherEvent, { event: "runner" }>;
export type MemoryWait = Extract<LauncherEvent, { event: "memory_wait" }>;
export type ImageBuild = Extract<LauncherEvent, { event: "image_build" }>;

export const endOf = (event: LauncherEvent) => Date.parse(event.startedAt) + event.durationMs;
