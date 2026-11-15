import assert from "node:assert/strict";
import { test } from "node:test";
import { initials } from "./initials.ts";

test("initials take the first letter of the first two words", () => {
  assert.equal(initials("avery example"), "AE");
  assert.equal(initials("  Avery   Middle Example "), "AM");
  assert.equal(initials("Avery"), "A");
});

test("initials keep a letter outside the basic plane whole", () => {
  assert.equal(initials("𝒜very Example"), "𝒜E");
});

test("a blank name has no initials, so the avatar falls back to its icon", () => {
  assert.equal(initials("   "), "");
});
