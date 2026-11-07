import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, stripControlCharacters } from "./format-report.ts";

test("durations read as seconds, then minutes", () => {
  assert.equal(formatDuration(null), "-");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(488_000), "8m 08s");
});

test("control characters from job names can't reach the terminal", () => {
  assert.equal(stripControlCharacters("test\u001b]0;owned\u0007‮"), "test]0;owned");
});
