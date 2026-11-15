import type { ThreadEvent } from "@runnerbox/contracts";
import type { StagedFile } from "../composerDraftStore.ts";

// A question this window sent to wait in a thread, as it was in the composer: the Markdown with
// its chips, the files staged for it, and the text the server holds. Kept so that if it isn't sent,
// the composer gets back exactly what was there. In memory: a reload keeps only the server's text.
export type QueuedDraft = { readonly markdown: string; readonly files: ReadonlyArray<StagedFile>; readonly sentText: string };

const waiting = new Map<string, QueuedDraft>();

export const queuedDrafts = {
  remember: (draftKey: string, draft: QueuedDraft) => void waiting.set(draftKey, draft),
  get: (draftKey: string) => waiting.get(draftKey),
  forget: (draftKey: string) => void waiting.delete(draftKey),
};

// What becomes of a waiting question when the thread's stream says something: it started, so
// forget it; it was stopped, cancelled or couldn't start, so hand it back; or nothing yet. A
// snapshot with nothing waiting means the server restarted, or the start was missed while away,
// which the thread itself tells apart: the question is there if it was sent.
export function queueOutcome(event: ThreadEvent, remembered: QueuedDraft | undefined): "returned" | "sent" | "waiting" {
  if (event._tag === "QueueCleared") return event.reason === "started" ? "sent" : "returned";
  if (event._tag !== "Snapshot" || remembered === undefined || event.queued) return "waiting";
  const sent = event.detail.items.some((item) => item._tag === "UserMessage" && item.source === undefined && item.text === remembered.sentText);
  return sent ? "sent" : "returned";
}
