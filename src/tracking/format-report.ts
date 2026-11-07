import type { JobSummary, StepComparison } from "./report.ts";

export function formatDuration(ms: number | null) {
  if (ms === null) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// Job names come from workflow files, so they can hold terminal escape sequences.
export function stripControlCharacters(text: string) {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

function table(rows: readonly (readonly string[])[]) {
  const clean = rows.map((row) => row.map(stripControlCharacters));
  const widths = clean[0]!.map((_, column) => Math.max(...clean.map((row) => row[column]!.length)));
  return clean
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd())
    .join("\n");
}

export function formatSummary(summaries: readonly JobSummary[]) {
  return table([
    ["JOB", "RUNNER", "RAN", "FAILED", "PASSED ON RETRY", "NO RUNNER", "P50", "P90", "QUEUE P50", "TOTAL"],
    ...summaries.map((row) => [
      row.job,
      row.runnerType,
      String(row.ran),
      String(row.failed),
      String(row.passedOnRetry),
      String(row.noRunner),
      formatDuration(row.p50Ms),
      formatDuration(row.p90Ms),
      formatDuration(row.queueP50Ms),
      formatDuration(row.totalMs),
    ]),
  ]);
}

export function formatStepComparison({ runnerTypes, steps }: StepComparison) {
  return table([
    ["STEP", ...runnerTypes],
    ...steps.map(({ name, p50MsByRunnerType }) => [
      name,
      ...runnerTypes.map((type) => formatDuration(p50MsByRunnerType.get(type) ?? null)),
    ]),
  ]);
}
