import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadEvent, ThreadItem, ThreadSummary } from "@runnerbox/contracts";
import { queueOutcome } from "./queuedDrafts.ts";
import { EMPTY_VIEW, foldThread } from "./threadView.ts";

const thread: ThreadSummary = { id: "t", subject: { _tag: "inbox", itemId: "i" }, title: "x", createdAt: "2026-01-01T00:00:00Z", lastAt: "2026-01-01T00:00:00Z", running: false };
const at = "2026-01-01T00:00:01Z";

test("streamed text builds up, then the logged text replaces it, and the turn's end stops it", () => {
  const events: ThreadEvent[] = [
    { _tag: "Snapshot", detail: { thread, items: [] }, partial: null },
    { _tag: "UserMessage", seq: 1, turnId: "a", text: "Why?", at },
    { _tag: "AgentTextDelta", turnId: "a", text: "Because " },
    { _tag: "AgentTextDelta", turnId: "a", text: "memory." },
  ];
  const streaming = events.reduce(foldThread, EMPTY_VIEW);
  assert.deepEqual([streaming.running, streaming.partial?.text], [true, "Because memory."]);
  const logged = foldThread(streaming, { _tag: "AgentText", seq: 2, turnId: "a", text: "Because memory.", at });
  assert.equal(logged.partial, null);
  const ended = foldThread(logged, { _tag: "TurnEnded", seq: 3, turnId: "a", outcome: "completed", message: null, costUsd: null, at });
  assert.deepEqual([ended.running, ended.items.map((item) => item._tag)], [false, ["UserMessage", "AgentText", "TurnEnded"]]);
});

test("a snapshot taken mid-turn resumes from the text already streamed", () => {
  const view = foldThread(EMPTY_VIEW, { _tag: "Snapshot", detail: { thread: { ...thread, running: true }, items: [] }, partial: { turnId: "a", text: "Look" } });
  assert.equal(foldThread(view, { _tag: "AgentTextDelta", turnId: "a", text: "ing" }).partial?.text, "Looking");
});

test("a waiting question comes back to the composer unless it was sent, a restart included", () => {
  const remembered = { markdown: "Is it **this**?", files: [], sentText: "Is it **this**?" };
  const snapshot = (items: ThreadItem[], queued: { text: string; at: string } | null) => ({ _tag: "Snapshot" as const, detail: { thread, items }, partial: null, queued });
  const asked: ThreadItem = { _tag: "UserMessage", seq: 1, turnId: "t", text: "Is it **this**?", at };
  assert.equal(queueOutcome({ _tag: "QueueCleared", reason: "stopped", text: "x", message: null }, remembered), "returned");
  assert.equal(queueOutcome({ _tag: "QueueCleared", reason: "started", text: "x", message: null }, remembered), "sent");
  assert.equal(queueOutcome(snapshot([], { text: "x", at }), remembered), "waiting");
  // After a restart nothing waits, and it was never asked: back it comes.
  assert.equal(queueOutcome(snapshot([], null), remembered), "returned");
  // It started while this window was away: the thread has it.
  assert.equal(queueOutcome(snapshot([asked], null), remembered), "sent");
  const view = foldThread(foldThread(EMPTY_VIEW, snapshot([], null)), { _tag: "Queued", message: { text: "x", at } });
  assert.deepEqual(view.queued, { text: "x", at });
  assert.equal(foldThread(view, { _tag: "QueueCleared", reason: "cancelled", text: "x", message: null }).queued, null);
});
