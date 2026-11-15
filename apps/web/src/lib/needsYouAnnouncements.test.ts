import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnnounce } from "./needsYouAnnouncements.ts";

test("each new item is announced once, and turning on announces no backlog", () => {
  const first = toAnnounce(["a", "b"], null);
  assert.deepEqual(first.announce, []);
  const second = toAnnounce(["a", "b", "c"], first.seen);
  assert.deepEqual(second.announce, ["c"]);
  assert.deepEqual(toAnnounce(["b", "c"], second.seen).announce, [], "an item that left and came back isn't announced again");
});
