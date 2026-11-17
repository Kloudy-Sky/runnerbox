import { type InboxItem, type InboxSummary, isInboxItemHidden } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { jobTotals } from "../history/jobTotals.ts";
import { plainDuration, plural } from "./jobs.ts";

const HOUR_MS = 60 * 60_000;
const hours = (ms: number) => plural(Math.round(ms / HOUR_MS), "hour");

// The home screen's headline: whether anything needs the owner, and four facts about the window.
export function summarize(jobs: readonly JobRecord[], items: readonly InboxItem[], days: number): InboxSummary {
  const { jobs: ran, passed, failed, typicalWaitMs, ownMachinesMs, githubMachinesMs } = jobTotals(jobs);
  const passRate = passed + failed === 0 ? null : passed / (passed + failed);
  // What the owner snoozed or settled waits out of the count.
  const needYou = items.filter((item) => item.group === "needs_you" && !isInboxItemHidden(item)).length;
  const window = days === 1 ? "the last day" : `the last ${days} days`;
  // What needs the owner comes first: when nothing ran because every runner is failing, that's
  // the news, not the quiet week.
  const headline =
    needYou > 0
      ? `${needYou === 1 ? "1 thing needs" : `${needYou} things need`} you.${ran > 0 ? " The rest is fine." : ""}`
      : ran === 0
        ? `No jobs ran in ${window}.`
        : "Nothing needs you right now.";
  const facts = [
    `${plural(ran, "job")} ran in ${window}.`,
    ...(passRate === null ? [] : [`${Math.round(passRate * 100)} in 100 passed.`]),
    ...(typicalWaitMs === null ? [] : [`A typical job waited ${plainDuration(typicalWaitMs)} for a runner.`]),
    `${hours(ownMachinesMs)} on your machines, ${hours(githubMachinesMs)} on GitHub's machines.`,
  ];
  return { needYou, jobs: ran, passRate, typicalWaitMs, ownMachinesMs, githubMachinesMs, headline, facts };
}
