import type { Inbox, InboxCostLevel, InboxItem, MonitorStatus, PullRequest, ReviewsView, ReviewSummary } from "@runnerbox/contracts";
import { mergeKey } from "./needsYouEverywhere.ts";

// What one machine answered. Any part is missing while it loads, or when the machine is offline,
// and then adds nothing and hides nothing.
export type MachineAnswers = {
  readonly environmentId: string;
  readonly inbox: Inbox | undefined;
  readonly monitors?: MonitorStatus | undefined;
  readonly reviews?: ReviewsView | undefined;
  // The GitHub login the machine is signed in as, which makes a pull request the owner's.
  readonly login?: string | null | undefined;
};

// One copy of an item per machine that reports it, so snooze, settle and approve reach each.
export type ItemCopy = { readonly environmentId: string; readonly item: InboxItem };

export type ItemStatus = "fix_ready" | "back" | "answer_ready" | "failing" | "looking" | "snoozed" | "settled" | "handled";
// `id` is the row's key, the item's own id for a kind machines share, else the machine and its id.
// `item` is the newest copy, the one shown, and `newestOn` the machine that sent it.
export type ItemRow = { readonly id: string; readonly item: InboxItem; readonly newestOn: string; readonly copies: ReadonlyArray<ItemCopy>; readonly status: ItemStatus };

type ReviewedPull = PullRequest & { readonly review: ReviewSummary };
export type ReviewRow = { readonly id: string; readonly pull: ReviewedPull; readonly environmentIds: ReadonlyArray<string>; readonly status: "review_done" | "reviewing" };

const COST_ORDER: Record<InboxCostLevel, number> = { blocking: 0, slower: 1, nothing_yet: 2 };
const costRank = (item: InboxItem) => (item.cost ? COST_ORDER[item.cost.level] : 3);

// Two machines that sync the same repository report the same failure under the same id. It's one
// row, told by the machine that saw it last, holding every machine's copy. A machine's own kind,
// such as a slot that keeps failing, stays its own row (see needsYouEverywhere).
function mergeItems(machines: ReadonlyArray<MachineAnswers>, pick: (inbox: Inbox) => ReadonlyArray<InboxItem>) {
  const byId = new Map<string, { item: InboxItem; newestOn: string; copies: ItemCopy[] }>();
  for (const { environmentId, inbox } of machines) {
    for (const item of inbox ? pick(inbox) : []) {
      const key = mergeKey(environmentId, item);
      const held = byId.get(key);
      if (!held) byId.set(key, { item, newestOn: environmentId, copies: [{ environmentId, item }] });
      else {
        held.copies.push({ environmentId, item });
        if (Date.parse(item.at) > Date.parse(held.item.at)) {
          held.item = item;
          held.newestOn = environmentId;
        }
      }
    }
  }
  return [...byId.entries()].map(([id, held]) => ({ id, ...held }));
}

// A monitor looks into an item on the machine that reported it, so only those machines' monitors count.
function itemStatus({ item, copies }: Omit<ItemRow, "status">, machines: ReadonlyArray<MachineAnswers>): ItemStatus {
  const monitors = machines.filter((machine) => copies.some((copy) => copy.environmentId === machine.environmentId)).flatMap((machine) => (machine.monitors ? [machine.monitors] : []));
  if (item.state?.status === "settled") return "settled";
  if (item.state?.status === "snoozed") return "snoozed";
  if (monitors.some((status) => status.runs.some((run) => run.outcome === "running" && run.itemId === item.id))) return "looking";
  // Each machine's rule writes its own fix, so any copy with one makes it ready, as Approve sees it.
  if (copies.some((copy) => copy.item.fix)) return "fix_ready";
  if (item.state?.status === "back") return "back";
  if (monitors.some((status) => status.unread.includes(item.id))) return "answer_ready";
  return "failing";
}

// The owner's open pull requests with a review, once each, with the newest review either machine has.
function ownReviews(machines: ReadonlyArray<MachineAnswers>) {
  const byPull = new Map<string, { pull: ReviewedPull; environmentIds: string[] }>();
  for (const { environmentId, reviews, login } of machines) {
    if (!reviews || !login) continue;
    for (const pull of reviews.pulls) {
      const { review } = pull;
      if (!review || pull.author.toLowerCase() !== login.toLowerCase()) continue;
      const id = `${pull.repo}#${pull.number}`;
      const held = byPull.get(id);
      if (!held) byPull.set(id, { pull: { ...pull, review }, environmentIds: [environmentId] });
      else {
        held.environmentIds.push(environmentId);
        if (Date.parse(review.startedAt) > Date.parse(held.pull.review.startedAt)) held.pull = { ...pull, review };
      }
    }
  }
  return [...byPull.entries()].map(([id, held]) => ({ id, ...held }));
}

// The Inbox tab's list across every connected machine: what needs the owner, most costly first,
// then their reviews that found something, then the shelves, and the quiet groups as counts.
export function inboxRows(machines: ReadonlyArray<MachineAnswers>) {
  const items: ReadonlyArray<ItemRow> = mergeItems(machines, (inbox) => inbox.items).map((row) => ({ ...row, status: itemStatus(row, machines) }));
  const shelved = new Set<ItemStatus>(["looking", "snoozed", "settled"]);
  const reviews = ownReviews(machines).flatMap((row): ReadonlyArray<ReviewRow> => {
    const { state, p1, p2 } = row.pull.review;
    if (state === "queued" || state === "running") return [{ ...row, status: "reviewing" }];
    return state === "done" && p1 + p2 > 0 ? [{ ...row, status: "review_done" }] : [];
  });
  // Each machine titles its quiet groups with its own counts, "3 flaky jobs"; per kind, the machine
  // that counted most stands for them all.
  const handled = [...Map.groupBy(machines.flatMap(({ inbox }) => inbox?.quiet ?? []), (group) => group.kind).values()].map(
    (groups) => groups.reduce((largest, group) => (group.items.length > largest.items.length ? group : largest)).title,
  );
  // Quiet items aren't listed, but still open from a notification, the command palette or a pull request.
  const quiet = mergeItems(machines, (inbox) => inbox.quiet.flatMap((group) => group.items)).map((row): ItemRow => ({ ...row, status: "handled" }));
  return {
    // Array sort is stable, so items of one cost keep the order the server gave them.
    needsYou: items.filter((row) => !shelved.has(row.status)).toSorted((a, b) => costRank(a.item) - costRank(b.item)),
    reviews: reviews.filter((row) => row.status === "review_done"),
    working: { items: items.filter((row) => row.status === "looking"), reviews: reviews.filter((row) => row.status === "reviewing") },
    snoozed: items.filter((row) => row.status === "snoozed"),
    settled: items.filter((row) => row.status === "settled"),
    handled,
    all: [...items, ...quiet],
  };
}

export type InboxRows = ReturnType<typeof inboxRows>;

// The row a link names: by its key, or, from a link that has only the item's id, the first row of
// that item, preferring the given machine's.
export const findRow = (rows: ReadonlyArray<ItemRow>, id: string, preferOn?: string) =>
  rows.find((row) => row.id === id) ??
  rows.find((row) => row.item.id === id && row.copies.some((copy) => copy.environmentId === preferOn)) ??
  rows.find((row) => row.item.id === id);
