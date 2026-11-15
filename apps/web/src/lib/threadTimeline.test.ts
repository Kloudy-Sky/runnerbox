import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreadItem } from "@runnerbox/contracts";
import { timelineRows } from "./threadTimeline.ts";

const question = (seq: number, turnId: string, at: string): ThreadItem => ({ _tag: "UserMessage", seq, turnId, text: "Why?", at });
const tool = (seq: number, turnId: string, name = "list_runs"): ThreadItem => ({ _tag: "ToolCall", seq, turnId, name, input: "{}", at: "2026-01-01T00:00:05Z" });
const ended = (seq: number, turnId: string, outcome: "completed" | "interrupted" | "failed", message: string | null, at: string): ThreadItem => ({
  _tag: "TurnEnded",
  seq,
  turnId,
  outcome,
  message,
  costUsd: null,
  at,
});
const kinds = (items: ReadonlyArray<ThreadItem>) => timelineRows(items).map((row) => (row.kind === "fold" || row.kind === "divider" ? `${row.kind}:${row.label}` : row.kind));

test("a finished turn's work folds under how long the turn took, from its question to its end", () => {
  const items = [question(1, "a", "2026-01-01T00:00:00Z"), tool(2, "a"), tool(3, "a", "repro_exec"), { _tag: "AgentText", seq: 4, turnId: "a", text: "Because.", at: "2026-01-01T00:01:10Z" } as const, ended(5, "a", "completed", null, "2026-01-01T00:01:20Z")];
  assert.deepEqual(kinds(items), ["question", "fold:Worked for 1m 20s", "answer"]);
  const fold = timelineRows(items)[1];
  assert.equal(fold?.kind === "fold" && fold.entries.length, 1);
});

test("a running turn shows its calls together as they come", () => {
  assert.deepEqual(kinds([question(1, "a", "2026-01-01T00:00:00Z"), tool(2, "a"), tool(3, "a")]), ["question", "work"]);
});

test("a turn the owner stopped says so, even with no work", () => {
  assert.deepEqual(kinds([question(1, "a", "2026-01-01T00:00:00Z"), ended(2, "a", "interrupted", null, "2026-01-01T00:00:40Z")]), ["question", "fold:You stopped after 40s"]);
});

test("a failed turn and one the server lost each end on a divider", () => {
  const failed = [question(1, "a", "2026-01-01T00:00:00Z"), ended(2, "a", "failed", "No login.", "2026-01-01T00:00:01Z")];
  assert.deepEqual(kinds(failed), ["question", "divider:Failed"]);
  const lost = [question(1, "a", "2026-01-01T00:00:00Z"), ended(2, "a", "interrupted", "The server stopped during this turn.", "2026-01-01T00:00:01Z")];
  assert.deepEqual(kinds(lost), ["question", "divider:The server stopped during this turn."]);
});
