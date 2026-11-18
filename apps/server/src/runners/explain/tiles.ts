import type { InstallState, RunnerTile } from "@runnerbox/contracts";
import { jobText } from "./words.ts";

type Slot = InstallState["kinds"][number]["slots"][number];

// `up` backs off for a moment after every runner, which is starting the next one, not trouble.
// An older `up` wrote it in lower case.
const NEXT_RUNNER = /^starting the next runner\.?$/i;
// The reasons `up` gives in plain words since #106. Anything else is an older `up`'s wording, or
// names an exit code, which only the raw rows show.
const PLAIN_WHY = [/^The VM has .+ free\./, /^The machine has .+ free\./, /^Waiting behind \d+ runners? /, /^Couldn't get a registration from GitHub\.$/];
const EXITED_FAST = /^the last runner exited .+ within a minute$/;
const OLD_MINT_FAILED = "could not mint a registration";

// A failed read carries the error's own text, which can hold anything, so only its gist is shown.
const UNREADABLE = /Runnerbox couldn't read the (VM|machine)'s memory/;

function whyOf(detail: string | null) {
  if (detail === null) return null;
  const unreadable = UNREADABLE.exec(detail);
  if (unreadable) return `Runnerbox couldn't read the ${unreadable[1]}'s memory.`;
  if (PLAIN_WHY.some((pattern) => pattern.test(detail))) return detail;
  if (EXITED_FAST.test(detail)) return "Its last runner stopped within a minute of starting.";
  if (detail === OLD_MINT_FAILED) return "Couldn't get a registration from GitHub.";
  return null;
}

// An `up` that reports a slot's job writes `job` on every slot, null when it has none. Without it,
// a registered runner may be ready or on a job.
const reportsJobs = (install: InstallState) => install.kinds.some((kind) => kind.slots.some((slot) => slot.job !== undefined));

function stateOf(slot: Slot, knowsJobs: boolean): Pick<RunnerTile, "state" | "phase"> {
  switch (slot.phase) {
    case "busy":
      return { state: "running", phase: "busy" };
    case "registered":
      return { state: knowsJobs ? "ready" : "maybe_running", phase: "registered" };
    case "waiting":
      return { state: "stepped_aside", phase: "waiting" };
    case "minting":
      return { state: "starting", phase: "minting" };
    case "backoff":
      return slot.detail !== null && NEXT_RUNNER.test(slot.detail) ? { state: "starting", phase: "minting" } : { state: "retrying", phase: "backoff" };
    case "stopped":
      return { state: "stopped", phase: "stopped" };
  }
}

// Every runner of an install, kind by kind, as the page's tiles show it.
export function tiles(install: InstallState): RunnerTile[] {
  const knowsJobs = reportsJobs(install);
  return install.kinds.flatMap((kind) =>
    kind.slots.map((slot) => {
      const { state, phase } = stateOf(slot, knowsJobs);
      return {
        kind: kind.name,
        slot: slot.slot,
        state,
        phase,
        job: phase === "busy" && slot.job ? jobText(slot.job) : null,
        why: phase === "waiting" || phase === "backoff" ? whyOf(slot.detail) : null,
        since: slot.since,
        runner: slot.runner,
      };
    }),
  );
}
