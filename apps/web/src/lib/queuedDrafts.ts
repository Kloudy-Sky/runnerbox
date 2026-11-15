import type { ThreadEvent } from "@runnerbox/contracts";
import type { QueuedDraft } from "../composerDraftStore.ts";

// What becomes of a question this window queued when the thread's stream says something: it
// started, so forget it; it was stopped, cancelled or couldn't start, so hand it back; or nothing
// yet. A snapshot with nothing waiting means the server restarted, or the start was missed while
// away, which the thread itself tells apart: a question with its text after the one it waited
// behind means it was sent.
export function queueOutcome(event: ThreadEvent, remembered: QueuedDraft | undefined): "returned" | "sent" | "waiting" {
  if (remembered === undefined) return "waiting";
  if (event._tag === "QueueCleared") return event.reason === "started" ? "sent" : "returned";
  if (event._tag !== "Snapshot" || event.queued) return "waiting";
  const sent = event.detail.items.some((item) => item._tag === "UserMessage" && item.source === undefined && item.seq > remembered.afterSeq && item.text === remembered.sentText);
  return sent ? "sent" : "returned";
}
