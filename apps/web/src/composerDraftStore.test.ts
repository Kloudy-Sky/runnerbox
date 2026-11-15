import assert from "node:assert/strict";
import { test } from "node:test";
import { keptDrafts } from "./composerDraftStore.ts";

const DAY = 24 * 60 * 60_000;

test("a draft survives a restart for a month, and storage another version wrote is ignored rather than breaking the composer", () => {
  const now = Date.UTC(2026, 10, 14);
  const drafts = { fresh: { value: "Is it the **VM**?", at: now - 29 * DAY }, stale: { value: "old", at: now - 31 * DAY } };
  assert.deepEqual(keptDrafts({ drafts }, now), { fresh: drafts.fresh });
  assert.deepEqual(keptDrafts({ drafts: { broken: { value: 7 } } }, now), {});
  assert.deepEqual(keptDrafts(undefined, now), {});
});
