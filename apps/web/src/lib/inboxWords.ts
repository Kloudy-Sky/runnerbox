import type { ItemRow, ItemStatus, ReviewRow } from "./inboxRows.ts";

// A row's status in a word or two, and its colour. Red is only failing and amber only waiting on
// the owner; the rest stay white or dim.
export const STATUS_WORDS: Record<ItemStatus | ReviewRow["status"], { readonly label: string; readonly tone: string }> = {
  fix_ready: { label: "Fix ready", tone: "text-warning" },
  failing: { label: "Failing", tone: "text-destructive" },
  back: { label: "Back", tone: "text-foreground" },
  answer_ready: { label: "Answer ready", tone: "text-foreground" },
  looking: { label: "Agent looking", tone: "text-muted-foreground" },
  snoozed: { label: "Snoozed", tone: "text-muted-foreground" },
  settled: { label: "Settled", tone: "text-muted-foreground" },
  handled: { label: "Handled", tone: "text-muted-foreground" },
  review_done: { label: "Review done", tone: "text-foreground" },
  reviewing: { label: "Review running", tone: "text-muted-foreground" },
};

export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// Where a row's item is. A machine's own kind of item is keyed by its machine (mergeKey), and
// another machine may report one with the same id and words, so it names the machine; a shared one
// names its install or repository.
export const rowWhere = (row: ItemRow, machine: string) => (row.id !== row.item.id ? machine : (row.item.install ?? row.item.repo ?? machine));

// Under a row's title: where it is, then what it costs, "linux-box · blocking 2 pull requests".
export const itemMeta = (row: ItemRow, machine: string) => [rowWhere(row, machine), row.item.cost ? lowerFirst(row.item.cost.text) : null].filter(Boolean).join(" · ");

export const reviewMeta = ({ pull }: ReviewRow) => {
  const count = pull.review.p1 + pull.review.p2;
  return `${pull.repo} · ${count} ${count === 1 ? "thing" : "things"} to fix`;
};
