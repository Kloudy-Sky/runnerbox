import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";

// What the inbox's sentences call the machine a job ran on: its install, as the app names installs.
export const UNKNOWN_MACHINE = "this machine";

export const machineOf = (job: JobRecord, events: readonly LauncherEvent[]) =>
  events.find((event) => event.event === "runner" && event.runner === job.runner)?.install ?? UNKNOWN_MACHINE;
