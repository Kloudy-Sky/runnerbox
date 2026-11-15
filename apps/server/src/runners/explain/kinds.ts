import type { KindStory, RunnerTile, RunnerTileState } from "@runnerbox/contracts";
import { listed, plainDuration } from "../../inbox/jobs.ts";
import { endOf, type ExplainInput } from "./input.ts";
import { HOUR_MS } from "./lanes.ts";
import { runsOf } from "./runs.ts";
import { times } from "./words.ts";

const RECENT_MS = 30 * 60_000;

const STATE_WORDS: Record<RunnerTileState, [one: string, many: string]> = {
  running: ["is running a job", "are running a job"],
  ready: ["is ready", "are ready"],
  maybe_running: ["is ready or running a job", "are ready or running a job"],
  stepped_aside: ["has stepped aside for memory", "have stepped aside for memory"],
  starting: ["is starting", "are starting"],
  retrying: ["is waiting before it tries again", "are waiting before they try again"],
  stopped: ["is stopped", "are stopped"],
};

// "its 1 runner is ready", "both of its 2 runners are running a job", "of its 3 runners, 1 is
// running a job and 2 are ready".
function nowWords(own: readonly RunnerTile[], now: number) {
  const byState = [...Map.groupBy(own, (tile) => tile.state)];
  if (byState.length === 1) {
    const [state] = byState[0]!;
    const verb = own.length === 1 ? STATE_WORDS[state][0] : STATE_WORDS[state][1];
    const who = own.length === 1 ? "its 1 runner" : own.length === 2 ? "both of its 2 runners" : `all ${own.length} of its runners`;
    const sofar = state === "running" && own.length === 1 ? `, for ${plainDuration(now - Date.parse(own[0]!.since))} so far` : "";
    return `${who} ${verb}${sofar}`;
  }
  const parts = byState.map(([state, tiles]) => `${tiles.length} ${tiles.length === 1 ? STATE_WORDS[state][0] : STATE_WORDS[state][1]}`);
  return `of its ${own.length} runners, ${listed(parts)}`;
}

// One sentence per kind: the label its jobs ask for, what its runners are doing, and what the
// records add: how often it stepped aside lately, or when its last job ended.
export function kindStories(input: ExplainInput, runners: readonly RunnerTile[], failing: ReadonlySet<string>): KindStory[] {
  const { install, now } = input;
  const runs = runsOf(input);
  return install.kinds.map((kind) => {
    const own = runners.filter((tile) => tile.kind === kind.name);
    const one = own.length === 1;
    const aside = input.events.filter((event) => event.event === "memory_wait" && event.runnerType === kind.name && now - endOf(event) < RECENT_MS).length;
    const lastJob = runs
      .filter((run) => run.took && run.event.runnerType === kind.name)
      .map((run) => (run.record?.completedAt ? Date.parse(run.record.completedAt) : endOf(run.event)))
      .reduce((latest, end) => Math.max(latest, end), -Infinity);
    const allReady = own.length > 0 && own.every((tile) => tile.state === "ready");
    const extra = [
      failing.has(kind.name) ? `${one ? "Its runner keeps" : "Its runners keep"} failing before ${one ? "it takes" : "they take"} a job.` : null,
      aside > 0 ? `${one ? "It" : "They"} stepped aside ${times(aside)} in the last half hour.` : null,
      allReady
        ? now - lastJob < HOUR_MS
          ? `${one ? "Its" : "Their"} last job ended ${plainDuration(now - lastJob)} ago.`
          : `${one ? "It hasn't" : "They haven't"} run a job in the last hour.`
        : null,
    ].filter((part) => part !== null);
    const sentence = own.length === 0 ? `${kind.name}, for jobs that ask for ${kind.label}, has no runners.` : `${kind.name}, for jobs that ask for ${kind.label}: ${nowWords(own, now)}.`;
    const limits = runs.findLast((run) => run.event.runnerType === kind.name && run.event.limits)?.event.limits ?? null;
    return { name: kind.name, label: kind.label, sentence: [sentence, ...extra].join(" "), limits };
  });
}

