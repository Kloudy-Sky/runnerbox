import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadItem, ThreadSummary } from "@runnerbox/contracts";
import { queueOutcome } from "./queuedDrafts.ts";

const at = "2026-01-01T00:00:00Z";
const thread: ThreadSummary = { id: "0123456789abcdef", subject: { _tag: "inbox", itemId: "x" }, title: "x", createdAt: at, lastAt: at, running: false };
const snapshot = (items: ThreadItem[], queued: { text: string; at: string } | null) => ({ _tag: "Snapshot" as const, detail: { thread, items }, partial: null, queued });
const asked = (seq: number, text: string): ThreadItem => ({ _tag: "UserMessage", seq, turnId: `t${seq}`, text, at });
// Queued while the thread's last item was seq 4.
const remembered = { markdown: "Why?", files: [], sentText: "Why?", afterSeq: 4, at: 0 };

test("a waiting question comes back to the composer unless it was sent, a restart included", () => {
  assert.equal(queueOutcome({ _tag: "QueueCleared", reason: "stopped", text: "Why?", message: null }, remembered), "returned");
  assert.equal(queueOutcome({ _tag: "QueueCleared", reason: "started", text: "Why?", message: null }, remembered), "sent");
  assert.equal(queueOutcome(snapshot([], { text: "Why?", at }), remembered), "waiting");
  // After a restart nothing waits, and it was never asked: back it comes.
  assert.equal(queueOutcome(snapshot([], null), remembered), "returned");
  // It started while this window was away: the thread has it, after the item it waited behind.
  assert.equal(queueOutcome(snapshot([asked(5, "Why?")], null), remembered), "sent");
});

test("the same words asked before the question was queued don't count as it being sent", () => {
  assert.equal(queueOutcome(snapshot([asked(1, "Why?")], null), remembered), "returned");
});

test("a window that didn't queue the question never gets it", () => {
  assert.equal(queueOutcome({ _tag: "QueueCleared", reason: "stopped", text: "Why?", message: null }, undefined), "waiting");
});
