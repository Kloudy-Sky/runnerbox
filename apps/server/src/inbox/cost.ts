import type { InboxCost, InboxCostLevel } from "@runnerbox/contracts";
import { plural } from "./jobs.ts";
import type { InboxInput } from "./rules.ts";

export const SLOWER: InboxCost = { level: "slower", text: "Slower, nothing blocked" };
export const NOTHING_YET: InboxCost = { level: "nothing_yet", text: "Nothing yet" };
// Without the GitHub sign-in, or on a repository whose pull requests weren't read, there's nothing to count.
const NOT_COUNTED: InboxCost = { level: "nothing_yet", text: "Pull requests not counted" };

export const COST_ORDER: Record<InboxCostLevel, number> = { blocking: 0, slower: 1, nothing_yet: 2 };

// What a failing check costs: the open pull requests in `repo` whose head commit is one it failed on.
export function blockingCost(repo: string, failedOn: ReadonlySet<string>, openPulls: InboxInput["openPulls"]): InboxCost {
  const heads = openPulls?.get(repo);
  if (heads === undefined) return NOT_COUNTED;
  const blocked = heads.filter((sha) => failedOn.has(sha)).length;
  return blocked === 0 ? NOTHING_YET : { level: "blocking", text: `Blocking ${plural(blocked, "pull request")}` };
}
