import type { InboxItem, LauncherEvent, QuietKind } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { ADVICE } from "./advice.ts";
import { at, DAY_MS, listed, plural, STARVED_AFTER_MS, starved } from "./jobs.ts";
import type { InboxInput } from "./rules.ts";

// The runner types this machine's launcher serves: any it has a live kind for, or whose jobs ran on
// a runner it recorded. Other labels belong to GitHub's own runners or to another machine.
function servedTypes(input: InboxInput) {
  const ours = new Set(input.events.flatMap((event) => (event.event === "runner" ? [event.runner] : [])));
  const fromJobs = input.jobs.filter((job) => job.runner !== null && ours.has(job.runner)).map(runnerType);
  const fromKinds = input.installs.flatMap((install) => install.kinds.map((kind) => kind.label));
  return new Set([...fromJobs, ...fromKinds]);
}

// Memory waits that overlapped a job's time without a runner explain why no slot took it.
const overlapping = (events: readonly LauncherEvent[], jobs: readonly JobRecord[]) =>
  events.filter(
    (event) =>
      event.event === "memory_wait" &&
      jobs.some((job) => {
        const start = Date.parse(event.startedAt);
        return start <= Date.parse(at(job)) && start + event.durationMs >= Date.parse(job.createdAt);
      }),
  );

const minutes = STARVED_AFTER_MS / 60_000;

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
    const waits = overlapping(input.events, jobs);
    const byPlace = Map.groupBy(jobs, (job) => `${job.repo}, ${runnerType(job)}`);
    const breakdown = [...byPlace].map(([label, group]) => {
      const memory = overlapping(input.events, group).length;
      return { label, count: group.length, detail: memory > 0 ? `${plural(memory, "memory wait")} meanwhile` : "" };
    }).toSorted((a, b) => b.count - a.count);
    const byLabel = [...Map.groupBy(jobs, runnerType)].toSorted((a, b) => b[1].length - a[1].length);
    const labels = byLabel.map(([label]) => label);
    const [top, topJobs] = byLabel[0]!;
    const most =
      labels.length === 1 ? ` All were on ${top}.` : topJobs.length * 2 > jobs.length ? ` Most were on ${top}.` : ` They were on ${listed(labels)}.`;
    const repos = [...new Set(jobs.map((job) => job.repo))];
    const memoryWhy = `Your machine was short of free memory ${waits.length === 1 ? "once" : `${waits.length} times`} while they waited, so it couldn't start more runners.`;
    const unexplainedWhy = "Nothing in the logs explains it. Your runners may all have been busy, or up may not have been running.";
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
            why: waits.length > 0 ? memoryWhy : unexplainedWhy,
            action:
              quiet === null
                ? waits.length > 0
                  ? ADVICE.memory
                  : "Check that up is running and that its runners are listening for these labels."
                : "Nothing to do now. If it happens again, it comes back here.",
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
          reasons: waits.length > 0 ? [memoryWhy] : [],
          breakdown,
        },
      } satisfies InboxItem,
    ];
  });
}
