import type { InboxItem, QuietKind } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { ADVICE } from "./advice.ts";
import { at, DAY_MS, listed, plainDuration, plural, STARVED_AFTER_MS, starved } from "./jobs.ts";
import type { InboxInput } from "./rules.ts";
import { type WaitCause, waitCause } from "./waitCause.ts";

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

const runnersOf = ({ kinds }: WaitCause) => `the ${listed(kinds)} runners`;
// "There is one linux runner", "There are 2 linux runners": the owner reads runners, not slots.
const thereAre = ({ kinds }: WaitCause, slots: number) => (slots === 1 ? `There is one ${listed(kinds)} runner` : `There are ${slots} ${listed(kinds)} runners`);

// Why one label's jobs waited, in one or two plain sentences, for a label whose kinds and their
// `slots` are known.
function whyFor(cause: WaitCause, slots: number) {
  const runners = runnersOf(cause);
  const { peak, typicalMs } = cause;
  const memoryFor = cause.memoryMs >= cause.waitedMs * WHOLE_TIME_SHARE ? "the whole time these jobs waited" : `${plainDuration(cause.memoryMs)} of the ${plainDuration(cause.waitedMs)} these jobs were waiting`;
  if (cause.cause === "memory") return `The machine was short of free memory for ${runners} for ${memoryFor}, so it couldn't start more of them.`;
  if (cause.cause === "slots") {
    const clearing =
      typicalMs === null ? "" : ` A typical job there takes ${plainDuration(typicalMs)}, so ${slots === 1 ? "one runner needs" : `${slots} runners need`} about ${plainDuration((peak * typicalMs) / slots)} to clear ${peak}.`;
    return `${thereAre(cause, slots)}, and ${slots === 1 ? "it was" : slots === 2 ? "both were" : "all were"} busy the whole time these jobs waited. ${peak} jobs were waiting for a runner at the same time.${clearing}`;
  }
  const busy = cause.waitedMs > 0 ? Math.round((cause.busyMs / cause.waitedMs) * 100) : 0;
  const all = slots === 1 ? "it was" : "they were all";
  const full = busy === 0 ? `${slots === 1 ? "it was never busy" : "they were never all busy at once"} while these jobs waited` : `${all} busy for ${busy}% of the time these jobs waited`;
  const memory = cause.memoryMs > 0 ? ` The machine was short of free memory for them for ${memoryFor}, too little to explain it.` : " The machine was never short of free memory for them.";
  return `The logs don't show why. ${thereAre(cause, slots)}, and ${full}.${memory}`;
}

// What the owner can do, matching the reason given. More runners only help if the machine has the
// memory for them, so that's said when the samples show it ran low.
function actionFor(cause: WaitCause) {
  if (cause.cause === "memory") return ADVICE.memory;
  if (cause.cause === "slots") {
    const memory = cause.tight ? ` More runners need more memory, and the ${cause.tight} ran low while these jobs ran, so give it more memory too.` : "";
    return `Add more ${listed(cause.kinds)} runners, or move short jobs to a lighter kind of runner so they don't wait behind long ones.${memory}`;
  }
  return "Check that Runnerbox is running on the machine and that its runners are listening for these labels.";
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
    const labels = byLabel.map(([label]) => label);
    const [top, topJobs] = byLabel[0]!;
    const most =
      labels.length === 1 ? ` All were on ${top}.` : topJobs.length * 2 > jobs.length ? ` Most were on ${top}.` : ` They were on ${listed(labels)}.`;
    const repos = [...new Set(jobs.map((job) => job.repo))];
    const unknownKinds = causes.filter((cause) => cause.slots === null).map((cause) => cause.label);
    const whys = [
      ...causes.flatMap((cause) => (cause.slots === null ? [] : [whyFor(cause, cause.slots)])),
      ...(unknownKinds.length > 0 ? [`The logs don't show which of your runners serve ${listed(unknownKinds)}, so they don't say why these jobs waited.`] : []),
    ];
    const words =
      quiet === "other_runners"
        ? {
            title: "Jobs waited for runners this machine doesn't run",
            happened: `${plural(jobs.length, "job")} on ${listed(labels)} waited more than ${minutes} minutes and ended without a runner.`,
            why: "Those labels belong to another machine or to GitHub's machines, so no runner here could take them.",
            action: "Nothing to do here, unless this machine should serve those labels.",
          }
        : {
            title: quiet === null ? "Jobs are waiting too long for a runner" : "Jobs waited too long for a runner more than a day ago",
            happened: `${plural(jobs.length, "job")} waited more than ${minutes} minutes for one of your runners and ended without getting one.${most}${quiet === null ? "" : " Since then, runners have taken jobs on those labels again."}`,
            why: whys.join(" "),
            action: quiet === null ? [...new Set(causes.map(actionFor))].join(" ") : "Nothing to do now. If it happens again, it comes back here.",
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
          reasons: whys,
          breakdown,
        },
      } satisfies InboxItem,
    ];
  });
}
