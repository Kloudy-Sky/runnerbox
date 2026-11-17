import type { InboxItem, QuietKind } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { SLOWER } from "./cost.ts";
import { at, DAY_MS, listed, plainDuration, plural, STARVED_AFTER_MS, starved } from "./jobs.ts";
import { UNKNOWN_MACHINE } from "./machines.ts";
import type { InboxInput } from "./rules.ts";
import { kindsServing, type WaitCause, waitCause } from "./waitCause.ts";

// The runner types this machine's launcher serves: any it has a live kind for, or whose jobs ran on
// a runner it recorded. Other labels belong to GitHub's own runners or to another machine.
function servedTypes(input: InboxInput) {
  const ours = new Set(input.events.flatMap((event) => (event.event === "runner" ? [event.runner] : [])));
  const fromJobs = input.jobs.filter((job) => job.runner !== null && ours.has(job.runner)).map(runnerType);
  const fromKinds = input.installs.flatMap((install) => install.kinds.map((kind) => kind.label));
  return new Set([...fromJobs, ...fromKinds]);
}

const minutes = STARVED_AFTER_MS / 60_000;
// Memory waits covering this share of the wait are said to have lasted "the whole time", since a
// few seconds' gap at either end isn't worth a figure.
const WHOLE_TIME_SHARE = 0.95;

const memoryFor = (cause: WaitCause) =>
  cause.memoryMs >= cause.waitedMs * WHOLE_TIME_SHARE ? "the whole time these jobs waited" : `${plainDuration(cause.memoryMs)} of the ${plainDuration(cause.waitedMs)} these jobs were waiting`;
const clearing = ({ peak, typicalMs }: WaitCause, slots: number) =>
  typicalMs === null ? "" : ` A typical job takes ${plainDuration(typicalMs)}, so ${slots === 1 ? "one runner needs" : `${slots} runners need`} about ${plainDuration((peak * typicalMs) / slots)} to get through ${peak}.`;

// The machines whose runners take one label's jobs, for a label whose kinds are known.
const machinesFor = (cause: WaitCause, input: InboxInput) => listed([...new Set([...kindsServing(cause.label, input).keys()].map((key) => key.split("\0")[0]!))].toSorted());
const busyShare = (cause: WaitCause) => (cause.waitedMs > 0 ? Math.round((cause.busyMs / cause.waitedMs) * 100) : 0);

// Why one label's jobs waited, for the evidence, in the launcher's terms: kinds and their `slots`.
function reasonFor(cause: WaitCause, slots: number) {
  const kind = `the ${listed(cause.kinds)} ${cause.kinds.length === 1 ? "kind" : "kinds"}`;
  const memory = `memory waits on ${kind} covered ${memoryFor(cause)}`;
  if (cause.cause === "memory") return memory;
  if (cause.cause === "slots") return `all ${plural(slots, "slot")} of ${kind} were busy the whole time, with ${cause.peak} jobs on ${cause.label} queued at once`;
  return `all ${plural(slots, "slot")} of ${kind} were busy for ${busyShare(cause)}% of the wait, and ${cause.memoryMs > 0 ? memory : `no memory wait on ${kind} overlapped it`}`;
}

// Why they waited, in plain words for the owner: runners on a machine, without kinds or labels.
function whyFor(cause: WaitCause, slots: number, machine: string) {
  const runners = slots === 1 ? `There is one runner for these jobs on ${machine}` : `There are ${slots} runners for these jobs on ${machine}`;
  if (cause.cause === "memory") return `Free memory on ${machine} was too low to start another runner for ${memoryFor(cause)}.`;
  if (cause.cause === "slots") {
    return `${runners}, and ${slots === 1 ? "it was" : slots === 2 ? "both were" : "all were"} busy the whole time. ${cause.peak} jobs were waiting at once.${clearing(cause, slots)}`;
  }
  const busy = busyShare(cause);
  const full = busy === 0 ? (slots === 1 ? "it was never busy" : "they were never all busy at once") : `${slots === 1 ? "it was" : "they were all"} busy for ${busy}% of the time`;
  const memory = cause.memoryMs > 0 ? ` Free memory ran short for ${memoryFor(cause)}, too little to explain it.` : " Free memory never ran short.";
  return `The logs don't show why. ${runners}, and ${full}.${memory}`;
}

// The one step that fixes it, matching the reason given. Another runner only helps if the machine
// has the memory for it, so that comes first when the samples show it ran low.
function actionFor(cause: WaitCause, machine: string) {
  if (cause.cause === "memory") return `Give the runners on ${machine} more memory, so more of them can start at once.`;
  if (cause.cause === "slots") {
    if (cause.tight === "VM") return `Give the runners on ${machine} more memory, then add a runner. They ran low on memory while these jobs ran.`;
    if (cause.tight === "host") return `Free up memory on ${machine}, then add a runner. It ran low on memory while these jobs ran.`;
    return `Add a runner on ${machine}.`;
  }
  return `Check that Runnerbox is running on ${machine}.`;
}

// Jobs that waited long enough for a runner and never got one. One cause, one item: every
// repository and label of this machine that starved in the last day is one item, with each one's
// share in the breakdown. Older waits, and waits for labels this machine doesn't serve, are quiet.
export function waitItems(input: InboxInput): InboxItem[] {
  const served = servedTypes(input);
  const waiting = input.jobs.filter(starved).toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  // A wait is over once it's more than a day old and a later job on its label got a runner.
  // Until then it still needs the owner, even if nothing has been pushed since.
  const over = (job: JobRecord) =>
    input.now - Date.parse(job.createdAt) >= DAY_MS &&
    input.jobs.some((other) => other.runner !== null && runnerType(other) === runnerType(job) && Date.parse(other.createdAt) > Date.parse(at(job)));
  const parts: { quiet: QuietKind | null; jobs: JobRecord[] }[] = [
    { quiet: null, jobs: waiting.filter((job) => served.has(runnerType(job)) && !over(job)) },
    { quiet: "resolved", jobs: waiting.filter((job) => served.has(runnerType(job)) && over(job)) },
    { quiet: "other_runners", jobs: waiting.filter((job) => !served.has(runnerType(job))) },
  ];
  return parts.flatMap(({ quiet, jobs }) => {
    if (jobs.length === 0) return [];
    const byLabel = [...Map.groupBy(jobs, runnerType)].toSorted((a, b) => b[1].length - a[1].length);
    const causes = quiet === "other_runners" ? [] : byLabel.map(([label, group]) => waitCause(label, group, input));
    const waits = causes.flatMap((cause) => cause.waits);
    const byPlace = Map.groupBy(jobs, (job) => `${job.repo}, ${runnerType(job)}`);
    const breakdown = [...byPlace].map(([place, group]) => {
      const memory = quiet === "other_runners" ? 0 : waitCause(runnerType(group[0]!), group, input).waits.length;
      return { label: place, count: group.length, detail: memory > 0 ? `${plural(memory, "memory wait")} on its runners meanwhile` : "" };
    }).toSorted((a, b) => b.count - a.count);
    const repos = [...new Set(jobs.map((job) => job.repo))];
    const known = causes.flatMap((cause) => (cause.slots === null ? [] : [{ cause, slots: cause.slots, machine: machinesFor(cause, input) }]));
    const unknownKinds = causes.filter((cause) => cause.slots === null).map((cause) => cause.label);
    const unknown = unknownKinds.length > 0 ? `The logs don't show which of your runners take these jobs, so they can't say why they waited.` : null;
    const whys = [...known.map(({ cause, slots, machine }) => whyFor(cause, slots, machine)), ...(unknown ? [unknown] : [])];
    const reasons = [
      ...known.map(({ cause, slots }) => reasonFor(cause, slots)),
      ...causes.flatMap((cause) => (cause.cause === "slots" && cause.tight ? [`the ${cause.tight} ran low on memory while ${cause.label} jobs ran`] : [])),
      ...(unknown ? [`The logs don't show which of your runners serve ${listed(unknownKinds)}, so they don't say why these jobs waited.`] : []),
    ];
    const machines = [...new Set(known.map(({ machine }) => machine))];
    const fix = [...new Set(known.map(({ cause, machine }) => actionFor(cause, machine)))].join(" ") || `Check that Runnerbox is running on ${UNKNOWN_MACHINE}.`;
    const gaveUp = `${plural(jobs.length, "job")} waited more than ${minutes} minutes for a runner and gave up.`;
    const words =
      quiet === "other_runners"
        ? {
            title: "Jobs waited for a runner no machine here has",
            happened: gaveUp,
            why: "They asked for another machine, or for one of GitHub's, so no runner here could take them.",
            action: "Nothing to do here, unless this machine should take those jobs.",
          }
        : {
            title:
              quiet === null
                ? `Jobs wait too long for a runner on ${machines.length === 1 ? machines[0] : "your machines"}`
                : "Jobs waited too long for a runner more than a day ago",
            happened: `${gaveUp}${quiet === null ? "" : " Since then, runners have taken those jobs again."}`,
            why: whys.join(" "),
            action: quiet === null ? fix : "Nothing to do now. If it happens again, it comes back here.",
          };
    const latest = jobs.at(-1)!;
    return [
      {
        id: `no_runner:${quiet ?? "needs_you"}`,
        kind: "no_runner",
        group: quiet === null ? "needs_you" : "quiet",
        quiet,
        verdict: null,
        repo: repos.length === 1 ? repos[0]! : null,
        install: null,
        ...words,
        ...(quiet === null ? { cost: SLOWER } : {}),
        at: latest.createdAt,
        evidence: {
          steps: [],
          attempts: jobs.map((job) => ({
            jobId: job.jobId,
            attempt: job.attempt,
            runId: job.runId,
            headSha: job.headSha ?? null,
            runner: null,
            runnerType: runnerType(job),
            conclusion: job.conclusion,
            startedAt: job.createdAt,
            durationMs: elapsedMs(job.createdAt, job.completedAt),
          })),
          machine: null,
          launcher: waits,
          durations: [],
          reasons,
          breakdown,
        },
      } satisfies InboxItem,
    ];
  });
}
