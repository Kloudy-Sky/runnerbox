import type { ThreadEvent, ThreadItem, ThreadSummary } from "@runnerbox/contracts";

// What the dock shows of one thread, folded from its stream: the logged items, the text the
// running turn has streamed so far, and whether a turn is running.
export type ThreadView = {
  readonly thread: ThreadSummary | null;
  readonly items: ReadonlyArray<ThreadItem>;
  readonly partial: { readonly turnId: string; readonly text: string } | null;
  readonly running: boolean;
};

export const EMPTY_VIEW: ThreadView = { thread: null, items: [], partial: null, running: false };

export function foldThread(view: ThreadView, event: ThreadEvent): ThreadView {
  switch (event._tag) {
    case "Snapshot":
      return { thread: event.detail.thread, items: event.detail.items, partial: event.partial, running: event.detail.thread.running };
    case "AgentTextDelta":
      return {
        ...view,
        running: true,
        partial: view.partial?.turnId === event.turnId ? { turnId: event.turnId, text: view.partial.text + event.text } : { turnId: event.turnId, text: event.text },
      };
    case "UserMessage":
      return { ...view, items: [...view.items, event], running: true };
    case "AgentText":
      return { ...view, items: [...view.items, event], partial: null };
    case "ToolCall":
    case "ReproduceStarted":
    case "ReproduceCommand":
    case "ReproduceEnded":
    case "ChangeProposed":
      return { ...view, items: [...view.items, event] };
    case "TurnEnded":
      return { ...view, items: [...view.items, event], partial: null, running: false };
  }
}

// Whether the thread's reproduce is running: it started, and hasn't ended since.
export const isReproducing = (items: ReadonlyArray<ThreadItem>) =>
  items.findLast((item) => item._tag === "ReproduceStarted" || item._tag === "ReproduceEnded")?._tag === "ReproduceStarted";
