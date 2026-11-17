import type { Inbox, InboxItem, QuietGroup, QuietKind } from "@runnerbox/contracts";
import { COST_ORDER } from "./cost.ts";
import { failureItems } from "./failures.ts";
import { plural } from "./jobs.ts";
import type { InboxInput } from "./rules.ts";
import { slotItems } from "./slots.ts";
import { slowItems } from "./slow.ts";
import { summarize } from "./summary.ts";
import { waitItems } from "./waits.ts";

// Only items that need the owner carry a cost.
const costOrder = (item: InboxItem) => (item.cost ? COST_ORDER[item.cost.level] : 0);

// Every item, those that need the owner first, the most costly first among those, then newest first.
export function deriveInbox(input: InboxInput): InboxItem[] {
  return [...failureItems(input), ...waitItems(input), ...slotItems(input), ...slowItems(input)].toSorted((a, b) =>
    a.group !== b.group ? (a.group === "needs_you" ? -1 : 1) : costOrder(a) - costOrder(b) || Date.parse(b.at) - Date.parse(a.at),
  );
}

// Quiet items are counted, not listed: one group per kind, in this order, titled by its count.
const QUIET_TITLES: Record<QuietKind, (count: number) => string> = {
  flaky: (count) => plural(count, "flaky job"),
  failed_once: (count) => plural(count, "one-off failure"),
  slow: (count) => `${plural(count, "job")} slower than usual`,
  own_code: (count) => `${plural(count, "job")} failing in ${count === 1 ? "its" : "their"} own code`,
  resolved: (count) => `${plural(count, "problem")} already fixed`,
  other_runners: () => "Waits for other machines' runners",
};

// `all` is the derived items, with their snooze and settle when the caller has them.
export function buildInbox(input: InboxInput, days: number, all: readonly InboxItem[] = deriveInbox(input)): Inbox {
  const quiet: QuietGroup[] = (Object.keys(QUIET_TITLES) as QuietKind[]).flatMap((kind) => {
    const items = all.filter((item) => item.quiet === kind);
    return items.length === 0 ? [] : [{ kind, title: QUIET_TITLES[kind](items.length), items }];
  });
  return { summary: summarize(input.jobs, all, days), items: all.filter((item) => item.group === "needs_you"), quiet };
}
