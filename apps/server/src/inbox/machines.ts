import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { listed } from "./jobs.ts";

// What the inbox's sentences call the machine a job ran on: its install, as the app names installs.
export const UNKNOWN_MACHINE = "this machine";

export const machineOf = (job: JobRecord, events: readonly LauncherEvent[]) =>
  events.find((event) => event.event === "runner" && event.runner === job.runner)?.install ?? UNKNOWN_MACHINE;

// Every machine the jobs ran on, listed, and whether there are several, so a sentence can agree
// with them. A job no recorded runner ran names nothing unless no job's machine is known.
export function machinesOf(jobs: readonly JobRecord[], events: readonly LauncherEvent[]) {
  const installs = [...new Set(jobs.map((job) => machineOf(job, events)).filter((name) => name !== UNKNOWN_MACHINE))].toSorted();
  return { name: installs.length === 0 ? UNKNOWN_MACHINE : listed(installs), many: installs.length > 1 };
}
