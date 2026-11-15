import type { InstallExplained } from "@runnerbox/contracts";
import { episodes } from "./episodes.ts";
import { failingKinds } from "./failing.ts";
import { headline } from "./headline.ts";
import type { ExplainInput } from "./input.ts";
import { kindStories } from "./kinds.ts";
import { lanes } from "./lanes.ts";
import { memoryPicture } from "./memory.ts";
import { tiles } from "./tiles.ts";

// One install's runners in plain words, as the Runners page and a runners thread show them.
export function explainInstall(input: ExplainInput): InstallExplained {
  const runners = tiles(input.install);
  const failing = failingKinds(input.events);
  return {
    install: input.install.install,
    stale: input.install.stale,
    headline: headline(input.install, runners, failing, input.now),
    memory: memoryPicture(input),
    runners,
    lanes: lanes(input),
    kinds: kindStories(input, runners, failing),
    episodes: episodes(input),
  };
}
