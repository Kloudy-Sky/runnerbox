import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxItem } from "@runnerbox/contracts";
import { announcements, toAnnounce } from "./needsYouAnnouncements.ts";

const evidence = { steps: [], attempts: [], machine: null, launcher: [], durations: [], reasons: [], breakdown: [] };
const item = (id: string): InboxItem => ({
  id, kind: "failing_slot", group: "needs_you", quiet: null, verdict: null, repo: null, install: "example",
  title: `title ${id}`, happened: `happened ${id}`, why: "", action: "", at: "2026-11-15T12:00:00Z", evidence,
});

test("each new item is announced once, and turning on announces no backlog", () => {
  const first = toAnnounce(["a", "b"], null);
  assert.deepEqual(first.announce, []);
  const second = toAnnounce(["a", "b", "c"], first.seen);
  assert.deepEqual(second.announce, ["c"]);
  assert.deepEqual(toAnnounce(["b", "c"], second.seen).announce, [], "an item that left and came back isn't announced again");
});

test("two new items get one notification each, and more get a single one that opens home", () => {
  assert.deepEqual(announcements([item("a"), item("b")]).map(({ title, itemId }) => [title, itemId]), [["title a", "a"], ["title b", "b"]]);
  const many = announcements([item("a"), item("b"), item("c"), item("d")]);
  assert.equal(many.length, 1);
  assert.equal(many[0]?.title, "4 things need you");
  assert.equal(many[0]?.itemId, null);
});
