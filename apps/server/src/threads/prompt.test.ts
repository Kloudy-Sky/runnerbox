import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MESSAGE_LENGTH, type ThreadItem } from "@runnerbox/contracts";
import { MAX_HISTORY_CHARS, turnPrompt } from "./prompt.ts";

const asked = (index: number, text: string): ThreadItem => ({ _tag: "UserMessage", seq: index + 1, turnId: `t${index}`, text, at: "2026-01-01T00:00:00Z" });
const historyOf = (prompt: string) => /<conversation_so_far>\n([\s\S]*)\n<\/conversation_so_far>/.exec(prompt)?.[1] ?? "";

test("a long thread's history is cut to its budget, oldest first, and says so", () => {
  const long = "x".repeat(MAX_MESSAGE_LENGTH);
  const history = historyOf(turnPrompt("{}", Array.from({ length: 20 }, (_, index) => asked(index, `${index} ${long}`)), "Last?"));
  assert.ok(history.length <= MAX_HISTORY_CHARS + 100);
  assert.match(history, /^\(17 earlier entries left out for length\.\)/);
  assert.ok(history.includes("Owner: 19 ") && !history.includes("Owner: 16 "));
});

test("one earlier entry longer than the whole budget still brings its end", () => {
  const history = historyOf(turnPrompt("{}", [asked(0, `${"y".repeat(MAX_HISTORY_CHARS)}the end`)], "Next?"));
  assert.ok(history.endsWith("the end") && history.length <= MAX_HISTORY_CHARS + 100);
});
