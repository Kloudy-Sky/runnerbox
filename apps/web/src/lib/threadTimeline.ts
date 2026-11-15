import type { ThreadItem } from "@runnerbox/contracts";
import { formatDuration } from "./format.ts";

type Item<Tag extends ThreadItem["_tag"]> = Extract<ThreadItem, { _tag: Tag }>;

// What the agent did between its words: a tool it called, or a command it ran in a reproduce.
export type WorkEntry = Item<"ToolCall"> | Item<"ReproduceCommand">;

// One row of the thread, as T3 Code's timeline lays a turn out: the question, the agent's work and
// words, and, once the turn is over, its work folded under one line saying how long it took.
export type TimelineRow =
  | { readonly kind: "question"; readonly item: Item<"UserMessage"> }
  | { readonly kind: "answer"; readonly item: Item<"AgentText"> }
  | { readonly kind: "work"; readonly id: string; readonly entries: ReadonlyArray<WorkEntry> }
  | { readonly kind: "fold"; readonly id: string; readonly label: string; readonly entries: ReadonlyArray<WorkEntry> }
  | { readonly kind: "proposal"; readonly item: Item<"ChangeProposed"> }
  | { readonly kind: "divider"; readonly id: string; readonly tone: "neutral" | "danger"; readonly label: string; readonly detail: string | null };

// Its own row says what these did: the command's line, and the proposal's block.
const SHOWN_ELSEWHERE = new Set(["repro_exec", "propose_change"]);

const isWork = (item: ThreadItem): item is WorkEntry =>
  item._tag === "ReproduceCommand" || (item._tag === "ToolCall" && !SHOWN_ELSEWHERE.has(item.name));

// How long a turn ran: from its question to its end, both of which every thread's log has always
// recorded, so threads from before this view read the same.
const ranFor = (from: string, to: string) => {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : null;
};

const foldLabel = (question: Item<"UserMessage">, end: Item<"TurnEnded">) => {
  const duration = ranFor(question.at, end.at);
  // The owner stopped it; the server losing a turn says so with a message, in its own row.
  if (end.outcome === "interrupted" && end.message === null) return duration ? `You stopped after ${duration}` : "You stopped this response";
  return duration ? `Worked for ${duration}` : "Worked";
};

const reproduceStarted = (item: Item<"ReproduceStarted">) =>
  `${item.kind}'s ${item.imageFallback ? "current image" : "image the job ran on"}, ${item.image}, commit ${item.commit.slice(0, 7)}${item.network === "setup" ? ". Its network goes after the first command." : ""}`;

export function timelineRows(items: ReadonlyArray<ThreadItem>): ReadonlyArray<TimelineRow> {
  const ends = new Map(items.flatMap((item) => (item._tag === "TurnEnded" ? [[item.turnId, item] as const] : [])));
  const work = Map.groupBy(items.filter(isWork), (item) => item.turnId);
  const rows: Array<TimelineRow> = [];
  for (const item of items) {
    switch (item._tag) {
      case "UserMessage": {
        rows.push({ kind: "question", item });
        const end = ends.get(item.turnId);
        const entries = work.get(item.turnId) ?? [];
        const stopped = end?.outcome === "interrupted" && end.message === null;
        if (end && (entries.length > 0 || stopped)) rows.push({ kind: "fold", id: `fold:${item.turnId}`, label: foldLabel(item, end), entries });
        break;
      }
      case "AgentText":
        rows.push({ kind: "answer", item });
        break;
      case "ToolCall":
      case "ReproduceCommand": {
        // A finished turn's work is in its fold; a running one's shows as it happens, a run of
        // calls together.
        if (!isWork(item) || ends.has(item.turnId)) break;
        const last = rows.at(-1);
        if (last?.kind === "work" && last.entries[0]?.turnId === item.turnId) rows[rows.length - 1] = { ...last, entries: [...last.entries, item] };
        else rows.push({ kind: "work", id: `work:${item.seq}`, entries: [item] });
        break;
      }
      case "ChangeProposed":
        rows.push({ kind: "proposal", item });
        break;
      case "ReproduceStarted":
        rows.push({ kind: "divider", id: `divider:${item.seq}`, tone: "neutral", label: "Container started", detail: reproduceStarted(item) });
        break;
      case "ReproduceEnded":
        rows.push({ kind: "divider", id: `divider:${item.seq}`, tone: "neutral", label: "Container removed", detail: item.reason });
        break;
      case "TurnEnded":
        if (item.outcome === "failed") rows.push({ kind: "divider", id: `divider:${item.seq}`, tone: "danger", label: "Failed", detail: item.message ?? "The turn failed." });
        else if (item.outcome === "interrupted" && item.message !== null) rows.push({ kind: "divider", id: `divider:${item.seq}`, tone: "neutral", label: item.message, detail: null });
        break;
    }
  }
  return rows;
}
