import { formatDuration, stripControlCharacters } from "./format-report.ts";
import type { LauncherRow } from "./launcher-summary.ts";
import type { MachineRow } from "./machine-summary.ts";
import type { JobSummary } from "./report.ts";

export type WeeklySummary = {
  repo: string;
  since: Date;
  until: Date;
  jobs: JobSummary[];
  launcher: LauncherRow[];
  machines: MachineRow[];
};

const JOB_ROWS = 25;

// Replaces every name that can identify a project: repos, workflows, jobs, runners, installs and
// runner kinds. Numbers and durations stay as they are.
export function redactSummary(summary: WeeklySummary, redact: (name: string) => string): WeeklySummary {
  return {
    ...summary,
    repo: redact(summary.repo),
    jobs: summary.jobs.map((row) => ({
      ...row,
      workflow: row.workflow === null ? null : redact(row.workflow),
      job: redact(row.job),
      runnerType: redact(row.runnerType),
    })),
    launcher: summary.launcher.map((row) => ({ ...row, install: redact(row.install), runnerType: redact(row.runnerType) })),
    machines: summary.machines.map((row) => ({ ...row, install: redact(row.install) })),
  };
}

// Pipes and newlines in a name would break the table.
const cell = (text: string) => stripControlCharacters(text).replaceAll("|", "\\|");
const mib = (value: number | null) => (value === null ? "-" : `${value} MiB`);
const count = String;

function table(header: readonly string[], rows: readonly (readonly string[])[]) {
  if (rows.length === 0) return "None recorded.";
  return [header, header.map(() => "---"), ...rows].map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
}

// Markdown for reading the week at a glance: the slowest jobs, what `up` did, and how close the
// machines came to running out.
export function formatWeeklySummary({ repo, since, until, jobs, launcher, machines }: WeeklySummary) {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return [
    `# runnerbox summary`,
    "",
    `${cell(repo)}, ${day(since)} to ${day(until)}.`,
    "",
    `## Jobs`,
    "",
    `The ${JOB_ROWS} job and runner pairs that used the most runner time.`,
    "",
    table(
      ["Workflow", "Job", "Runner", "Ran", "Failed", "Passed on retry", "No runner", "P50", "P90", "Queue P50", "Queue P90", "VM low P50", "VM swap P90"],
      jobs.slice(0, JOB_ROWS).map((row) => [
        row.workflow ?? "-",
        row.job,
        row.runnerType,
        count(row.ran),
        count(row.failed),
        count(row.passedOnRetry),
        count(row.noRunner),
        formatDuration(row.p50Ms),
        formatDuration(row.p90Ms),
        formatDuration(row.queueP50Ms),
        formatDuration(row.queueP90Ms),
        mib(row.vmLowP50MiB),
        mib(row.vmSwapP90MiB),
      ]),
    ),
    "",
    `## Launcher`,
    "",
    table(
      ["Install", "Kind", "Runners", "Failed", "Released for memory", "Released for image", "Memory waits", "Wait P90", "Builds", "Failed builds", "Build P50"],
      launcher.map((row) => [
        row.install,
        row.runnerType,
        count(row.runners),
        count(row.failedRunners),
        count(row.releasedForMemory),
        count(row.releasedForImage),
        count(row.memoryWaits),
        formatDuration(row.memoryWaitP90Ms),
        count(row.imageBuilds),
        count(row.failedBuilds),
        formatDuration(row.buildP50Ms),
      ]),
    ),
    "",
    `## Machines`,
    "",
    table(
      ["Install", "Samples", "VM available P10", "VM available min", "VM swap P90", "Host available P10"],
      machines.map((row) => [
        row.install,
        count(row.samples),
        mib(row.vmAvailableP10MiB),
        mib(row.vmAvailableMinMiB),
        mib(row.vmSwapP90MiB),
        mib(row.hostAvailableP10MiB),
      ]),
    ),
    "",
  ].join("\n");
}
