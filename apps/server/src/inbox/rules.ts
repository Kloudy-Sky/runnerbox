import type { Evidence, InboxItem, InstallState, LauncherEvent, Verdict } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { JobMachine } from "runnerbox/src/tracking/job-machine.ts";
import { percentile, runnerType } from "runnerbox/src/tracking/report.ts";

// The inbox: what CI needs from the person who runs the runners, decided by rules over data
// already recorded. The person owns the machines, not the code, so a code failure is for its author
// and lands under "no action"; what points at the machine, the runners or the queue needs them.

export type InboxInput = {
  now: number;
  jobs: readonly JobRecord[];
  // What the machine looked like while a job ran, or undefined when its install took no samples.
  machine: (job: JobRecord) => (JobMachine & { vmTotalMiB?: number; hostTotalMiB?: number }) | undefined;
  events: readonly LauncherEvent[];
  installs: readonly InstallState[];
};

const DAY_MS = 24 * 60 * 60_000;
// The VM or host had less than this share of its memory available at some sample during the job.
const LOW_MEMORY_SHARE = 0.1;
const SWAP_PRESSURE_MIB = 1024;
// A job flaky this often in the window is worth a look even though each retry passed.
const FREQUENT_FLAKES = 3;
// Consecutive failed runners at the end of a slot's history before it counts as failing.
const FAILING_STREAK = 3;
// A run counts as slow when it took this much longer than the job's median, and at least a minute.
const SLOW_FACTOR = 1.5;
const SLOW_MIN_EXTRA_MS = 60_000;
const SLOW_MIN_HISTORY = 5;
// A job with no runner that ended sooner than this was cancelled or superseded, not starved.
const STARVED_AFTER_MS = 5 * 60_000;

const isFailure = ({ conclusion }: JobRecord) => conclusion === "failure" || conclusion === "timed_out";
const durationMs = (job: JobRecord) => elapsedMs(job.startedAt, job.completedAt);
const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;
const median = (values: readonly number[]) => percentile(values, 50);
// Attempts of a job on one commit, across every run and runner type. Records from before the
// commit was recorded fall back to one run, which is always one commit.
const unitKey = (job: JobRecord) => `${job.repo}\0${job.headSha ? `sha:${job.headSha}` : `run:${job.runId}`}\0${job.workflow}\0${job.job}`;
const sameUnit = (a: JobRecord, b: JobRecord) => unitKey(a) === unitKey(b);
// Attempt numbers restart in each run, so attempts on a commit are ordered by when they started.
const startedMs = (job: JobRecord) => Date.parse(job.startedAt ?? job.createdAt);
const jobKey = (job: JobRecord) => `${job.repo}\0${job.workflow}\0${job.job}`;
const jobName = (job: Pick<JobRecord, "workflow" | "job">) => (job.workflow ? `${job.workflow} / ${job.job}` : job.job);
const at = (job: JobRecord) => job.completedAt ?? job.startedAt ?? job.createdAt;
const failedRunner = (event: LauncherEvent) => event.event === "runner" && !event.released && event.exitCode !== 0;

// Why the machine, not the code, looks responsible for one failed attempt. Empty when nothing does.
export function machineReasons(job: JobRecord, input: Pick<InboxInput, "machine" | "events">): string[] {
  const reasons: string[] = [];
  const machine = input.machine(job);
  if (machine) {
    const { vmLowMiB, vmTotalMiB, hostLowMiB, hostTotalMiB, vmSwapPeakMiB } = machine;
    if (present(vmLowMiB) && present(vmTotalMiB) && vmLowMiB < vmTotalMiB * LOW_MEMORY_SHARE) {
      reasons.push(`VM memory fell to ${vmLowMiB} of ${vmTotalMiB} MiB available`);
    }
    if (present(hostLowMiB) && present(hostTotalMiB) && hostLowMiB < hostTotalMiB * LOW_MEMORY_SHARE) {
      reasons.push(`host memory fell to ${hostLowMiB} of ${hostTotalMiB} MiB available`);
    }
    if (present(vmSwapPeakMiB) && vmSwapPeakMiB >= SWAP_PRESSURE_MIB) reasons.push(`VM swap reached ${vmSwapPeakMiB} MiB`);
  }
  // A runner exits 0 after its one job whether the job passed or not, so any other exit is the
  // container or SSH failing under it.
  const runner = input.events.find((event) => event.event === "runner" && event.runner === job.runner);
  if (runner?.event === "runner" && !runner.released && runner.exitCode !== 0) {
    reasons.push(runner.exitCode === null ? "SSH to the VM dropped during the job" : `the container exited ${runner.exitCode}`);
  }
  return reasons;
}

type Unit = { key: string; attempts: JobRecord[]; verdict: Verdict; reasons: string[] };

// Gives each run of a job with a failed attempt its verdict. Infra wins over flaky: a retry that
// passed after the machine ran out of memory still points at the machine.
export function classifyFailures(jobs: readonly JobRecord[], input: Pick<InboxInput, "machine" | "events">): Unit[] {
  const considered = jobs.filter((job) => job.conclusion !== "skipped");
  const units: Unit[] = [];
  for (const [key, group] of Map.groupBy(considered, unitKey)) {
    const attempts = group.toSorted((a, b) => startedMs(a) - startedMs(b));
    const failed = attempts.filter((job) => job.runner !== null && isFailure(job));
    if (failed.length === 0) continue;
    const reasons = failed.flatMap((job) => machineReasons(job, input));
    const lastFailure = Math.max(...failed.map(startedMs));
    const passedLater = attempts.some((job) => job.conclusion === "success" && startedMs(job) > lastFailure);
    const onCommit = attempts[0]?.headSha !== undefined;
    const types = new Set(failed.map(runnerType));
    const verdict: Verdict =
      reasons.length > 0
        ? "infra"
        : passedLater
          ? "flaky"
          : failed.length >= 2 || types.size >= 2
            ? "code"
            : "unconfirmed";
    if (verdict === "flaky") reasons.push(`failed, then passed on a later attempt ${onCommit ? "on the same commit" : "in the same run"}`);
    if (verdict === "code") {
      reasons.push(types.size >= 2 ? `failed on ${[...types].join(" and ")}` : `failed on all ${failed.length} attempts`);
    }
    if (verdict === "unconfirmed") reasons.push("one attempt on one runner type, and nothing points at the machine");
    units.push({ key, attempts, verdict, reasons });
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

function evidenceFor(job: JobRecord, attempts: readonly JobRecord[], history: readonly JobRecord[], input: InboxInput): Evidence {
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
  };
}

const VERDICT_TITLE: Record<Verdict, string> = {
  infra: "failed on the machine",
  flaky: "is flaky",
  code: "fails in its code",
  unconfirmed: "failed",
};

function failureItems(input: InboxInput): InboxItem[] {
  const units = classifyFailures(input.jobs, input);
  const latestOf = (unit: Unit) => unit.attempts.at(-1)!;
  // A later run of the same job on the same branch that passed means the failure is fixed.
  const fixed = (job: JobRecord) =>
    input.jobs.some(
      (other) =>
        jobKey(other) === jobKey(job) &&
        other.branch === job.branch &&
        other.conclusion === "success" &&
        Date.parse(other.createdAt) > Date.parse(job.createdAt) &&
        !sameUnit(other, job),
    );
  const groups = Map.groupBy(units, (unit) => `${jobKey(latestOf(unit))}\0${unit.verdict}`);
  return [...groups.values()].map((group) => {
    const unit = group.toSorted((a, b) => Date.parse(at(latestOf(b))) - Date.parse(at(latestOf(a))))[0]!;
    const job = latestOf(unit);
    const failedAttempt = unit.attempts.findLast(isFailure) ?? job;
    const runs = new Set(input.jobs.filter((other) => jobKey(other) === jobKey(job)).map((other) => other.runId)).size;
    const times = group.length === 1 ? "" : `${group.length} of ${runs} runs. `;
    const isFixed = fixed(job);
    const needsYou =
      !isFixed && (unit.verdict === "infra" || (unit.verdict === "flaky" && group.length >= FREQUENT_FLAKES));
    const evidence = evidenceFor(failedAttempt, unit.attempts, input.jobs, input);
    return {
      id: `failure:${jobKey(job)}:${unit.verdict}`,
      kind: "failure",
      group: needsYou ? "needs_you" : "no_action",
      verdict: unit.verdict,
      repo: job.repo,
      install: null,
      title: `${jobName(job)} ${VERDICT_TITLE[unit.verdict]}`,
      detail: `${times}${capitalize(unit.reasons[0] ?? "")}.${isFixed ? " A later run on this branch passed." : ""}`,
      at: at(job),
      evidence: { ...evidence, reasons: [...new Set(unit.reasons)] },
    } satisfies InboxItem;
  });
}

// The runner types this machine's launcher serves: any it has a live kind for, or whose jobs ran on
// a runner it recorded. Other labels belong to GitHub's own runners or to another machine.
function servedTypes(input: InboxInput) {
  const ours = new Set(input.events.flatMap((event) => (event.event === "runner" ? [event.runner] : [])));
  const fromJobs = input.jobs.filter((job) => job.runner !== null && ours.has(job.runner)).map(runnerType);
  const fromKinds = input.installs.flatMap((install) => install.kinds.map((kind) => kind.label));
  return new Set([...fromJobs, ...fromKinds]);
}

function noRunnerItems(input: InboxInput): InboxItem[] {
  const waiting = input.jobs.filter(
    (job) => job.runner === null && job.conclusion !== "skipped" && (elapsedMs(job.createdAt, job.completedAt) ?? 0) >= STARVED_AFTER_MS,
  );
  const served = servedTypes(input);
  const groups = Map.groupBy(waiting, (job) => `${job.repo}\0${runnerType(job)}`);
  return [...groups.values()].map((group) => {
    const sorted = group.toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const latest = sorted.at(-1)!;
    const label = runnerType(latest);
    // Memory waits that overlapped a job's time in the queue explain why no slot took it.
    const overlapping = input.events.filter(
      (event) =>
        event.event === "memory_wait" &&
        group.some((job) => {
          const start = Date.parse(event.startedAt);
          return start <= Date.parse(at(job)) && start + event.durationMs >= Date.parse(job.createdAt);
        }),
    );
    const times = overlapping.length === 1 ? "once" : `${overlapping.length} times`;
    const reasons = overlapping.length > 0 ? [`slots were waiting for memory ${times} meanwhile`] : [];
    const recent = input.now - Date.parse(latest.createdAt) < DAY_MS;
    const ours = served.has(label);
    return {
      id: `no_runner:${latest.repo}:${label}`,
      kind: "no_runner",
      group: recent && ours ? "needs_you" : "no_action",
      verdict: null,
      repo: latest.repo,
      install: null,
      title: `${group.length} ${group.length === 1 ? "job" : "jobs"} on ${label} waited at least ${STARVED_AFTER_MS / 60_000}m and never got a runner`,
      detail: !ours
        ? "This machine doesn't serve that label."
        : reasons.length > 0
          ? `${capitalize(reasons[0]!)}.`
          : "No runner picked them up before they ended.",
      at: latest.createdAt,
      evidence: {
        steps: [],
        attempts: sorted.map((job) => ({
          jobId: job.jobId,
          attempt: job.attempt,
          runId: job.runId,
          headSha: job.headSha ?? null,
          runner: null,
          runnerType: label,
          conclusion: job.conclusion,
          startedAt: job.createdAt,
          durationMs: elapsedMs(job.createdAt, job.completedAt),
        })),
        machine: null,
        launcher: overlapping,
        durations: [],
        reasons,
      },
    } satisfies InboxItem;
  });
}

function failingSlotItems(input: InboxInput): InboxItem[] {
  const runners = input.events.filter((event) => event.event === "runner");
  const bySlot = Map.groupBy(runners, (event) => `${event.install}\0${event.runnerType ?? "-"}\0${event.slot}`);
  return [...bySlot.values()].flatMap((events) => {
    const sorted = events.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const streak = sorted.slice(sorted.findLastIndex((event) => !failedRunner(event)) + 1);
    if (streak.length < FAILING_STREAK) return [];
    const last = streak.at(-1)!;
    if (last.event !== "runner") return [];
    const kind = last.runnerType ?? "default";
    const exits = [...new Set(streak.map((event) => (event.event === "runner" ? String(event.exitCode ?? "lost SSH") : "")))];
    const live = input.installs
      .find((install) => install.install === last.install)
      ?.kinds.find((candidate) => candidate.name === last.runnerType)
      ?.slots.find((slot) => slot.slot === last.slot);
    return [
      {
        id: `failing_slot:${last.install}:${kind}:${last.slot}`,
        kind: "failing_slot",
        group: "needs_you",
        verdict: null,
        repo: null,
        install: last.install,
        title: `Slot ${last.slot} of ${kind} keeps failing`,
        detail: `The last ${streak.length} runners exited ${exits.join(", ")}.${live?.phase === "backoff" ? " It's backing off now." : ""}`,
        at: new Date(Date.parse(last.startedAt) + last.durationMs).toISOString(),
        evidence: { steps: [], attempts: [], machine: null, launcher: streak, durations: [], reasons: [`${streak.length} failed runners in a row`] },
      } satisfies InboxItem,
    ];
  });
}

function slowItems(input: InboxInput): InboxItem[] {
  const passed = input.jobs.filter((job) => job.conclusion === "success" && job.runner !== null && durationMs(job) !== null);
  const groups = Map.groupBy(passed, (job) => `${jobKey(job)}\0${runnerType(job)}`);
  return [...groups.values()].flatMap((group) => {
    const sorted = group.toSorted((a, b) => Date.parse(a.startedAt!) - Date.parse(b.startedAt!));
    if (sorted.length <= SLOW_MIN_HISTORY) return [];
    const latest = sorted.at(-1)!;
    const slowerThan = (job: JobRecord, before: readonly JobRecord[]) => {
      const typical = median(before.map(durationMs).filter(present));
      const ms = durationMs(job)!;
      return typical !== null && ms > typical * SLOW_FACTOR && ms - typical >= SLOW_MIN_EXTRA_MS;
    };
    if (!slowerThan(latest, sorted.slice(0, -1))) return [];
    // Three slow runs in a row, each against the runs before it, is a regression, not noise.
    const regression =
      sorted.length >= SLOW_MIN_HISTORY + 3 && sorted.slice(-3).every((job, index, last) => slowerThan(job, sorted.slice(0, sorted.length - last.length + index)));
    const typical = median(sorted.slice(0, -1).map(durationMs).filter(present))!;
    const evidence = evidenceFor(latest, [latest], input.jobs, input);
    return [
      {
        id: `slow_job:${jobKey(latest)}:${runnerType(latest)}`,
        kind: "slow_job",
        group: regression ? "needs_you" : "no_action",
        verdict: null,
        repo: latest.repo,
        install: null,
        title: `${jobName(latest)} is slower than usual on ${runnerType(latest)}`,
        detail: `${formatMs(durationMs(latest)!)} against a median of ${formatMs(typical)}.${regression ? " The last 3 runs were all slow." : ""}`,
        at: at(latest),
        evidence: {
          ...evidence,
          durations: sorted.map((job) => ({ startedAt: job.startedAt!, ms: durationMs(job)! })),
          reasons: [`${Math.round((durationMs(latest)! / typical) * 10) / 10}x the median of ${sorted.length - 1} earlier runs`],
        },
      } satisfies InboxItem,
    ];
  });
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function formatMs(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Needs you first, then no action, newest first within each.
export function deriveInbox(input: InboxInput): InboxItem[] {
  return [...failureItems(input), ...noRunnerItems(input), ...failingSlotItems(input), ...slowItems(input)].toSorted(
    (a, b) => (a.group === b.group ? Date.parse(b.at) - Date.parse(a.at) : a.group === "needs_you" ? -1 : 1),
  );
}
