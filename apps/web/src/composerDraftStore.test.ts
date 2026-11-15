import assert from "node:assert/strict";
import { test } from "node:test";
import { keptDrafts } from "./composerDraftStore.ts";

const DAY = 24 * 60 * 60_000;

test("a draft survives a restart for a month, and storage another version wrote is ignored rather than breaking the composer", () => {
  const now = Date.UTC(2026, 10, 14);
  const shot = { id: "0123456789abcdef", name: "shot.png", size: 1024, kind: "image" as const };
  const drafts = {
    fresh: { value: "Is it the **VM**?", attachments: [{ ...shot, at: now - 2 * 60 * 60_000 }, { ...shot, id: "fedcba9876543210", at: now - 2 * DAY }], at: now - 29 * DAY },
    stale: { value: "old", attachments: [], at: now - 31 * DAY },
  };
  // The file staged two days ago is gone from the server, so the draft forgets it too.
  assert.deepEqual(keptDrafts({ drafts }, now), { fresh: { ...drafts.fresh, attachments: [drafts.fresh.attachments[0]] } });
  // A draft saved before attachments existed survives an upgrade, with no files.
  assert.deepEqual(keptDrafts({ drafts: { older: { value: "Why?", at: now - DAY } } }, now), { older: { value: "Why?", attachments: [], at: now - DAY } });
  assert.deepEqual(keptDrafts({ drafts: { broken: { value: 7 } } }, now), {});
  assert.deepEqual(keptDrafts(undefined, now), {});
});
