import type { InboxItem, InboxSummary } from "@runnerbox/contracts";
import { elapsedMs, type JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { durationMs, isFailure, median, plainDuration, plural, present } from "./jobs.ts";

const HOUR_MS = 60 * 60_000;
const hours = (ms: number) => plural(Math.round(ms / HOUR_MS), "hour");

// The home screen's headline: whether anything needs the owner, and four facts about the window.
export function summarize(jobs: readonly JobRecord[], items: readonly InboxItem[], days: number): InboxSummary {
  const ran = jobs.filter((job) => job.runner !== null && job.conclusion !== "skipped");
  const decided = ran.filter((job) => job.conclusion === "success" || isFailure(job));
  const passRate = decided.length === 0 ? null : decided.filter((job) => job.conclusion === "success").length / decided.length;
  const typicalWaitMs = median(ran.map((job) => elapsedMs(job.createdAt, job.startedAt)).filter(present));
  const time = (own: boolean) =>
    ran.filter((job) => job.labels.includes("self-hosted") === own).reduce((sum, job) => sum + (durationMs(job) ?? 0), 0);
  const needYou = items.filter((item) => item.group === "needs_you").length;
  const window = days === 1 ? "the last day" : `the last ${days} days`;
  // What needs the owner comes first: when nothing ran because every runner is failing, that's
  // the news, not the quiet week.
  const headline =
    needYou > 0
      ? `${needYou === 1 ? "1 thing needs" : `${needYou} things need`} you.${ran.length > 0 ? " The rest is fine." : ""}`
      : ran.length === 0
        ? `No jobs ran in ${window}.`
        : "Nothing needs you. CI looks healthy.";
  const ownMachinesMs = time(true);
  const githubMachinesMs = time(false);
  const facts = [
    `${plural(ran.length, "job")} ran in ${window}.`,
    ...(passRate === null ? [] : [`${Math.round(passRate * 100)} in 100 passed.`]),
    ...(typicalWaitMs === null ? [] : [`A typical job waited ${plainDuration(typicalWaitMs)} for a runner.`]),
    `${hours(ownMachinesMs)} on your machines, ${hours(githubMachinesMs)} on GitHub's machines.`,
  ];
  return { needYou, jobs: ran.length, passRate, typicalWaitMs, ownMachinesMs, githubMachinesMs, headline, facts };
}
