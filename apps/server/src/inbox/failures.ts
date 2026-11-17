import type { InboxCost, InboxItem, QuietKind } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { runnerType } from "runnerbox/src/tracking/report.ts";
import { fixFor, mainCause } from "./advice.ts";
import { blockingCost, NOTHING_YET } from "./cost.ts";
import { at, capitalize, isFailure, jobKey, jobName, plural, present, sameUnit } from "./jobs.ts";
import { machineOf } from "./machines.ts";
import { classifyFailures, evidenceFor, type InboxInput, type MachineCause, plainCause, type Unit } from "./rules.ts";

const RESOLVED_ACTION = "Nothing to do now. If it fails this way again, it comes back here.";
// A job flaky this often in the window is worth a look even though each retry passed.
const FREQUENT_FLAKES = 3;

// What went wrong on the machine, for the title, as it keeps happening or as it happened once:
// "example runs out of memory", "example ran out of memory".
function causeTitle(causes: readonly MachineCause[], machine: string, again: boolean) {
  const short = !causes.some((cause) => cause.kind === "memory" && cause.source !== "swap");
  switch (mainCause(causes)) {
    case "memory":
      return `${machine} ${again ? "runs" : "ran"} ${short ? "short" : "out"} of memory`;
    case "connection":
      return `the connection to ${machine} ${again ? "drops" : "dropped"}`;
    case "container":
      return `${machine} ${again ? "stops" : "stopped"} it with an error`;
  }
}

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
    const check = `the ${jobName(job)} check`;
    const failedAttempt = unit.attempts.findLast(isFailure) ?? job;
    const machine = machineOf(failedAttempt, input.events);
    const runs = new Set(input.jobs.filter((other) => jobKey(other) === jobKey(job)).map((other) => other.runId)).size;
    const isFixed = fixed(job);
    const later = isFixed ? " A later run on this branch passed." : "";
    const howOften = `${capitalize(check)} failed ${group.length === 1 ? "once" : `${group.length} times`} in ${plural(runs, "run")}.`;
    const evidence = { ...evidenceFor(failedAttempt, unit.attempts, input.jobs, input), reasons: unit.reasons };
    const base = { id: `failure:${jobKey(job)}:${unit.verdict}`, kind: "failure" as const, verdict: unit.verdict, repo: job.repo, install: null, at: at(job), evidence };
    const item = (quiet: QuietKind | null, words: { title: string; happened: string; why: string; action: string }, cost: InboxCost = NOTHING_YET): InboxItem => ({
      ...base,
      group: quiet === null ? "needs_you" : "quiet",
      quiet,
      ...words,
      ...(quiet === null ? { cost } : {}),
    });

    switch (unit.verdict) {
      case "infra": {
        const causes = group.flatMap((each) => each.causes);
        const happened = `${howOften} ${plainCause(causes, machine)}`;
        const retried = unit.retried ? " The same code passed when it ran again." : "";
        const why = `The code isn't at fault.${retried} You run ${machine}, so only a change on ${machine} fixes it.`;
        // A retry that passed on a commit cleared its check, so only the commits still failing block.
        const failedOn = new Set(group.filter((each) => !each.retried).map((each) => latestOf(each).headSha).filter(present));
        return isFixed
          ? item("resolved", { title: `${capitalize(check)} failed on ${machine}, and a later run passed`, happened: `${happened}${later}`, why, action: RESOLVED_ACTION })
          : item(
              null,
              { title: `${capitalize(check)} ${group.length === 1 ? "failed" : "keeps failing"} because ${causeTitle(causes, machine, group.length > 1)}`, happened, why, action: fixFor(mainCause(causes), machine) },
              blockingCost(job.repo, failedOn, input.openPulls),
            );
      }
      case "flaky": {
        const happened = `It failed, then passed when it ran again, in ${group.length} of ${plural(runs, "run")}.${later}`;
        const why = "The same code failed and then passed, and the machine looked fine, so the check itself isn't reliable.";
        const frequent = group.length >= FREQUENT_FLAKES;
        return item(frequent ? (isFixed ? "resolved" : null) : "flaky", {
          title: `${capitalize(check)} fails now and then`,
          happened,
          why,
          action: !frequent
            ? "Nothing to do unless it keeps happening."
            : isFixed
              ? RESOLVED_ACTION
              : "Ask the agent to compare the latest failed run with the runs that passed.",
        });
      }
      case "code": {
        const failed = unit.attempts.filter(isFailure);
        const machines = new Set(failed.map(runnerType)).size;
        const why =
          machines >= 2
            ? `It failed on ${machines} different machines, and they looked fine, so the code is at fault.`
            : `It failed all ${failed.length} tries, and the machine looked fine, so the code is at fault.`;
        return isFixed
          ? item("resolved", { title: `${capitalize(check)} failed in its own code, and a later run passed`, happened: `${howOften}${later}`, why, action: RESOLVED_ACTION })
          : item("own_code", { title: `${capitalize(check)} fails in its own code`, happened: howOften, why, action: "Nothing for you. GitHub already told whoever changed the code." });
      }
      case "unconfirmed":
        return item("failed_once", {
          title: `${capitalize(check)} failed once`,
          happened: `${howOften}${later}`,
          why: "It failed once, and nothing points at the machine.",
          action: "Run it again if it matters. A second failure would show whether it's the code.",
        });
    }
  });
}
