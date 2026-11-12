import type { JobRun, Verdict } from "@runnerbox/contracts";
import { formatDuration, jobName } from "./format.ts";

// What a failure's verdict means, in words someone new to CI reads without a glossary.
export const VERDICT_WORDS: Record<Verdict, string> = {
  infra: "the machine",
  code: "the code",
  flaky: "flaky",
  unconfirmed: "failed once",
};

export const VERDICT_WHY: Record<Verdict, string> = {
  infra: "The machine, not the code, looks responsible: something was wrong with the runner while it ran.",
  code: "It fails in its own code: it failed every attempt, or on more than one kind of runner, and the machine looked fine.",
  flaky: "It's flaky: the same commit failed and then passed when retried, and the machine looked fine.",
  unconfirmed: "It failed once, on one kind of runner, and nothing points at the machine.",
};

export const VERDICT_ACTION: Record<Verdict, string> = {
  infra: "Ask the agent to look at the machine while it ran, and what to change.",
  code: "Nothing for you: the check already told whoever changed the code.",
  flaky: "Ask the agent to compare it with the runs that passed.",
  unconfirmed: "Run it again if it matters. A second failure would show whether it's the code.",
};

// One sentence on how a run went.
export function runHappened(run: JobRun) {
  const where = `${run.runnerType}${run.branch ? `, on ${run.branch}` : ""}`;
  if (run.runner === null) {
    return run.starved ? `It waited for a runner on ${where} and never got one.` : `It was cancelled before a runner took it, on ${where}.`;
  }
  const outcome =
    run.conclusion === "success"
      ? "passed"
      : run.conclusion === "failure"
        ? "failed"
        : run.conclusion === "timed_out"
          ? "timed out"
          : run.conclusion === "cancelled"
            ? "was cancelled"
            : (run.conclusion ?? "is still running");
  return `${jobName(run)} ${outcome} after ${formatDuration(run.durationMs)} on ${where}. It waited ${formatDuration(run.queueMs)} for a runner.`;
}
