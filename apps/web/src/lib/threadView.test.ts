import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadEvent, ThreadSummary } from "@runnerbox/contracts";
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
