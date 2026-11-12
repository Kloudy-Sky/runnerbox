import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultChannel, feedOf, isAheadOfFeed, isOffered } from "./channel.ts";

test("a build starts on its own channel, and each channel reads its own feed", () => {
  assert.equal(defaultChannel("0.2.1-nightly.20261112.41"), "nightly");
  assert.equal(defaultChannel("0.2.1"), "stable");
  assert.deepEqual(feedOf("stable"), { channel: "latest", allowPrerelease: false });
  assert.deepEqual(feedOf("nightly"), { channel: "nightly", allowPrerelease: true });
});

test("an update is only ever newer: a nightly user who switches to stable waits for the next stable", () => {
  const nightly = "0.2.1-nightly.20261113.42";
  assert.equal(isOffered(nightly, "0.2.0"), false, "the last stable is older than the nightly");
  assert.equal(isAheadOfFeed(nightly, "0.2.0"), true);
  assert.equal(isOffered(nightly, "0.2.1"), true, "the stable it previewed is newer");
  assert.equal(isOffered(nightly, "0.2.1-nightly.20261114.43"), true);
  assert.equal(isOffered("0.2.1", "0.2.1"), false);
  assert.equal(isOffered("0.2.1", "not-a-version"), false);
  assert.equal(isAheadOfFeed("0.2.1", "0.2.1"), false);
});
