import { stripControlCharacters } from "runnerbox/src/tracking/format-report.ts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { jobName } from "../../inbox/jobs.ts";

const JOB_NAME_CHARS = 60;

// A job's name as the page may show it. It comes from job output, so it's cut short and kept
// to one line of plain text.
export function jobText(name: string) {
  const line = stripControlCharacters(name).replace(/\s+/g, " ").trim();
  return line.length > JOB_NAME_CHARS ? `${line.slice(0, JOB_NAME_CHARS - 1)}…` : line;
}

export const recordName = (record: Pick<JobRecord, "workflow" | "job">) => jobText(jobName(record));

// "once", "twice", "11 times".
export const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);
