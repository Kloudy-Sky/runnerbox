import type { InboxItem, QuietKind } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { adviceFor } from "./advice.ts";
import { at, capitalize, isFailure, jobKey, jobName, listed, sameUnit } from "./jobs.ts";
import { classifyFailures, evidenceFor, type InboxInput, type Unit } from "./rules.ts";

const RESOLVED_ACTION = "Nothing to do now. If it fails this way again, it comes back here.";
// A job flaky this often in the window is worth a look even though each retry passed.
const FREQUENT_FLAKES = 3;

// One item per job and verdict: its failed runs judged together, worded for the owner.
export function failureItems(input: InboxInput): InboxItem[] {
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
    const name = jobName(job);
    const failedAttempt = unit.attempts.findLast(isFailure) ?? job;
    const runs = new Set(input.jobs.filter((other) => jobKey(other) === jobKey(job)).map((other) => other.runId)).size;
    const types = listed([...new Set(group.flatMap((each) => each.attempts.filter(isFailure).map(runnerType)))]);
    const isFixed = fixed(job);
    const later = isFixed ? " A later run on this branch passed." : "";
    const howOften = group.length === 1 ? `It failed on ${types}.` : `It failed in ${group.length} of ${runs} runs, on ${types}.`;
    const evidence = { ...evidenceFor(failedAttempt, unit.attempts, input.jobs, input), reasons: unit.reasons };
    const base = { id: `failure:${jobKey(job)}:${unit.verdict}`, kind: "failure" as const, verdict: unit.verdict, repo: job.repo, install: null, at: at(job), evidence };
    const item = (quiet: QuietKind | null, words: { title: string; happened: string; why: string; action: string }): InboxItem => ({
      ...base,
      group: quiet === null ? "needs_you" : "quiet",
      quiet,
      ...words,
    });

    switch (unit.verdict) {
      case "infra": {
        const why = `The machine, not the code, looks responsible: ${listed([...new Set(group.flatMap((each) => each.causes.map((cause) => cause.text)))])}.`;
        return isFixed
          ? item("resolved", { title: `${name} failed on this machine, and a later run passed`, happened: `${howOften}${later}`, why, action: RESOLVED_ACTION })
          : item(null, { title: `${name} fails on this machine, not in its code`, happened: howOften, why, action: adviceFor(group.flatMap((each) => each.causes)) });
      }
      case "flaky": {
        const happened = `It failed, then passed when retried, in ${group.length} of ${runs} runs.${later}`;
        const why = "The same code both failed and passed, and the machine looked fine, so something in the test or its setup isn't reliable.";
        const frequent = group.length >= FREQUENT_FLAKES;
        return item(frequent ? (isFixed ? "resolved" : null) : "flaky", {
          title: `${name} is flaky`,
          happened,
          why,
          action: !frequent
            ? "Nothing to do unless it keeps happening."
            : isFixed
              ? RESOLVED_ACTION
              : "Find the step that fails in the latest failed attempt. The agent can compare it with the runs that passed.",
        });
      }
      case "code":
        return item("own_code", {
          title: `${name} fails in its own code`,
          happened: `${howOften}${later}`,
          why: `${capitalize(unit.reasons.at(-1) ?? "")}, and the machine looked fine.`,
          action: "Nothing for you: the check already told whoever changed the code.",
        });
      case "unconfirmed":
        return item("failed_once", {
          title: `${name} failed once`,
          happened: `${howOften}${later}`,
          why: "It failed once, on one kind of runner, and nothing points at the machine.",
          action: "Run it again if it matters. A second failure would show whether it's the code.",
        });
    }
  });
}
