import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { ExplainInput, RunnerEvent } from "./input.ts";

// Each runner `up` recorded, with the job it ran when the job log knows it. A runner took a job
// when the log says so or when it ended cleanly without being released; one that ended with an
// error and no job in the log stopped before taking one.
export type Run = { event: RunnerEvent; record: JobRecord | null; took: boolean };

export function runsOf(input: Pick<ExplainInput, "events" | "jobs">): Run[] {
  const byRunner = new Map(input.jobs.flatMap((job) => (job.runner ? [[job.runner, job] as const] : [])));
  return input.events.flatMap((event) => {
    if (event.event !== "runner") return [];
    const record = byRunner.get(event.runner) ?? null;
    return [{ event, record, took: record !== null || (!event.released && event.exitCode === 0) }];
  });
}
