import type { Evidence, InstallState, LauncherEvent, Verdict } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { JobMachine } from "runnerbox/src/tracking/job-machine.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { durationMs, gib, isFailure, jobKey, jobName, median, present, startedMs, unitKey } from "./jobs.ts";

// The inbox's judgement: rules over data already recorded that tell the machine's failures from
// the code's. The person who reads it owns the machines, not the code, so a failure in a job's own
// code is for its author; what points at the machine, the runners or the wait needs them.

export type InboxInput = {
  now: number;
  jobs: readonly JobRecord[];
  // What the machine looked like while a job ran, or undefined when its install took no samples.
  machine: (job: JobRecord) => (JobMachine & { vmTotalMiB?: number; hostTotalMiB?: number }) | undefined;
  events: readonly LauncherEvent[];
  installs: readonly InstallState[];
};

// The VM or host had less than this share of its memory available at some sample during the job.
const LOW_MEMORY_SHARE = 0.1;
const SWAP_PRESSURE_MIB = 1024;
// A container killed by the kernel for memory exits 128 + 9.
export const OUT_OF_MEMORY_EXIT = 137;

// One sign that the machine, not the code, failed a job. `source` says what it was, for the plain
// sentence in Why; `text` states the figures, for the evidence. `kind` picks the advice.
export type MachineCause = {
  kind: "memory" | "connection" | "container";
  source: "vm_memory" | "host_memory" | "swap" | "out_of_memory" | "connection" | "exit";
  text: string;
};

export const exitText = (exitCode: number | null) =>
  exitCode === null
    ? "the connection to the VM dropped"
    : exitCode === OUT_OF_MEMORY_EXIT
      ? "its container stopped with exit code 137, which means it was killed for using too much memory"
      : `its container stopped with exit code ${exitCode}`;

// Why the machine, not the code, looks responsible for one failed attempt. Empty when nothing does.
export function machineCauses(job: JobRecord, input: Pick<InboxInput, "machine" | "events">): MachineCause[] {
  const causes: MachineCause[] = [];
  const machine = input.machine(job);
  if (machine) {
    const { vmLowMiB, vmTotalMiB, hostLowMiB, hostTotalMiB, vmSwapPeakMiB } = machine;
    if (present(vmLowMiB) && present(vmTotalMiB) && vmLowMiB < vmTotalMiB * LOW_MEMORY_SHARE) {
      causes.push({ kind: "memory", source: "vm_memory", text: `the VM had only ${gib(vmLowMiB)} of its ${gib(vmTotalMiB)} free` });
    }
    if (present(hostLowMiB) && present(hostTotalMiB) && hostLowMiB < hostTotalMiB * LOW_MEMORY_SHARE) {
      causes.push({ kind: "memory", source: "host_memory", text: `the host had only ${gib(hostLowMiB)} of its ${gib(hostTotalMiB)} free` });
    }
    if (present(vmSwapPeakMiB) && vmSwapPeakMiB >= SWAP_PRESSURE_MIB) causes.push({ kind: "memory", source: "swap", text: `the VM was swapping, with ${gib(vmSwapPeakMiB)} of swap in use` });
  }
  // A runner exits 0 after its one job whether the job passed or not, so any other exit is the
  // container or SSH failing under it.
  const runner = input.events.find((event) => event.event === "runner" && event.runner === job.runner);
  if (runner?.event === "runner" && !runner.released && runner.exitCode !== 0) {
    const { exitCode } = runner;
    causes.push(
      exitCode === null
        ? { kind: "connection", source: "connection", text: exitText(exitCode) }
        : exitCode === OUT_OF_MEMORY_EXIT
          ? { kind: "memory", source: "out_of_memory", text: exitText(exitCode) }
          : { kind: "container", source: "exit", text: exitText(exitCode) },
    );
  }
  return causes;
}

// The machine's causes as one plain sentence, without figures: "The VM ran out of memory while
// this job ran, and the job's container was stopped for it."
export function plainCause(causes: readonly MachineCause[]) {
  const has = (source: MachineCause["source"]) => causes.some((cause) => cause.source === source);
  const ranOut = has("vm_memory") || has("swap") ? "the VM" : has("host_memory") ? "the host" : null;
  const clauses = [
    ...(ranOut ? [`${ranOut} ran out of memory while this job ran`] : []),
    ...(has("out_of_memory") ? [ranOut ? "the job's container was stopped for it" : "the job's container was stopped for using too much memory"] : []),
    ...(has("connection") ? ["the connection to the VM dropped while it ran"] : []),
    ...(has("exit") ? ["the job's container stopped with an error"] : []),
  ];
  const sentence =
    clauses.length === 0 ? "something on the machine went wrong while this job ran" : clauses.length === 1 ? clauses[0]! : `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

// `retried` is true when an attempt on the same commit (or run) passed after the last failure.
export type Unit = { key: string; attempts: JobRecord[]; verdict: Verdict; causes: MachineCause[]; reasons: string[]; retried: boolean };

// Gives each run of a job with a failed attempt its verdict. Infra wins over flaky: a retry that
// passed after the machine ran out of memory still points at the machine.
export function classifyFailures(jobs: readonly JobRecord[], input: Pick<InboxInput, "machine" | "events">): Unit[] {
  const considered = jobs.filter((job) => job.conclusion !== "skipped");
  const units: Unit[] = [];
  for (const [key, group] of Map.groupBy(considered, unitKey)) {
    const attempts = group.toSorted((a, b) => startedMs(a) - startedMs(b));
    const failed = attempts.filter((job) => job.runner !== null && isFailure(job));
    if (failed.length === 0) continue;
    const causes = failed.flatMap((job) => machineCauses(job, input));
    const lastFailure = Math.max(...failed.map(startedMs));
    const passedLater = attempts.some((job) => job.conclusion === "success" && startedMs(job) > lastFailure);
    const onCommit = attempts[0]?.headSha !== undefined;
    const types = new Set(failed.map(runnerType));
    const verdict: Verdict =
      causes.length > 0
        ? "infra"
        : passedLater
          ? "flaky"
          : failed.length >= 2 || types.size >= 2
            ? "code"
            : "unconfirmed";
    const reasons = causes.map((cause) => cause.text);
    if (verdict === "flaky") reasons.push(`it failed, then passed when retried ${onCommit ? "on the same commit" : "in the same run"}`);
    if (verdict === "code") reasons.push(types.size >= 2 ? `it failed on ${[...types].join(" and ")}` : `it failed all ${failed.length} attempts`);
    if (verdict === "unconfirmed") reasons.push("it failed once, on one kind of runner, and nothing points at the machine");
    units.push({ key, attempts, verdict, causes, reasons: [...new Set(reasons)], retried: passedLater });
  }
  return units;
}

// The verdict for each failed attempt, by job ID, for the run list.
export function verdictsByJobId(jobs: readonly JobRecord[], input: Pick<InboxInput, "machine" | "events">) {
  return new Map(
    classifyFailures(jobs, input).flatMap((unit) =>
      unit.attempts.filter((job) => isFailure(job)).map((job) => [job.jobId, unit.verdict] as const),
    ),
  );
}

// Median time of each step across a job's successful runs, for comparing one run against.
function typicalSteps(jobs: readonly JobRecord[]) {
  const steps = jobs.filter((job) => job.conclusion === "success").flatMap((job) => job.steps);
  const byName = Map.groupBy(steps, (step) => step.name);
  return new Map([...byName].map(([name, list]) => [name, median(list.map((step) => step.ms).filter(present))]));
}

export function evidenceFor(job: JobRecord, attempts: readonly JobRecord[], history: readonly JobRecord[], input: InboxInput): Evidence {
  // Compared with the same job on the same kind of runner, since another kind can be much slower.
  const typical = typicalSteps(history.filter((other) => jobKey(other) === jobKey(job) && runnerType(other) === runnerType(job) && other !== job));
  const machine = input.machine(job);
  return {
    steps: job.steps.map((step) => ({ ...step, typicalMs: typical.get(step.name) ?? null })),
    attempts: attempts.map((attempt) => ({
      jobId: attempt.jobId,
      attempt: attempt.attempt,
      runId: attempt.runId,
      headSha: attempt.headSha ?? null,
      runner: attempt.runner,
      runnerType: runnerType(attempt),
      conclusion: attempt.conclusion,
      startedAt: attempt.startedAt,
      durationMs: durationMs(attempt),
    })),
    machine: machine
      ? {
          samples: machine.samples,
          vmLowMiB: machine.vmLowMiB ?? null,
          vmTotalMiB: machine.vmTotalMiB ?? null,
          hostLowMiB: machine.hostLowMiB ?? null,
          vmSwapPeakMiB: machine.vmSwapPeakMiB ?? null,
        }
      : null,
    launcher: input.events.filter((event) => event.event === "runner" && attempts.some((attempt) => attempt.runner === event.runner)),
    durations: [],
    reasons: [],
    breakdown: [],
  };
}

// One job attempt with what the inbox would show for it: its attempts on the same commit, its
// steps against the usual, the machine while it ran, and the failure verdict if it failed.
export function runEvidence(jobId: number, input: InboxInput) {
  const job = input.jobs.find((candidate) => candidate.jobId === jobId);
  if (!job) return undefined;
  const attempts = input.jobs.filter((other) => unitKey(other) === unitKey(job)).toSorted((a, b) => startedMs(a) - startedMs(b));
  const unit = isFailure(job) ? classifyFailures(attempts, input).find((candidate) => candidate.key === unitKey(job)) : undefined;
  const evidence = evidenceFor(job, attempts, input.jobs, input);
  return {
    title: `${jobName(job)} #${job.runId}${job.attempt > 1 ? ` attempt ${job.attempt}` : ""}`,
    job,
    verdict: unit?.verdict ?? null,
    evidence: { ...evidence, reasons: unit?.reasons ?? [] },
  };
}
