import assert from "node:assert/strict";
import { test } from "node:test";
import type { KindState } from "@runnerbox/contracts";
import { imageStatus } from "./imageFacts.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-11-15T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const kind: typeof KindState.Type = {
  name: "linux",
  label: "example-linux",
  image: "app-ci:aaaaaaaaaaaa",
  building: null,
  buildingSince: null,
  buildFailedAt: null,
  rebuildDays: 7,
  builtAt: ago(3 * DAY),
  tools: [],
  slots: [],
};

test("an image's word follows what's happening to it, a build first", () => {
  const word = (changes: Partial<typeof KindState.Type>) => imageStatus({ ...kind, ...changes }, now, 6 * 60_000)?.word ?? null;
  assert.equal(word({}), "Fresh");
  assert.equal(word({ builtAt: ago(8 * DAY) }), "Rebuild due");
  assert.equal(word({ rebuildDays: null }), "Built 3 days ago");
  assert.equal(word({ buildFailedAt: ago(60_000) }), "Rebuild failed");
  assert.equal(word({ building: "app-ci:bbbbbbbbbbbb", buildingSince: ago(2 * 60_000), buildFailedAt: ago(DAY) }), "Rebuilding");
  assert.equal(word({ image: null, buildFailedAt: ago(60_000), builtAt: null }), "Build failed");
  assert.equal(word({ builtAt: null }), null);
});

test("an image goes due when the machine's period turns, however young it is", () => {
  const week = 7 * DAY;
  const boundary = Math.floor(now / week) * week;
  const at = (ms: number) => new Date(ms).toISOString();
  assert.equal(imageStatus({ ...kind, builtAt: at(boundary - 2 * DAY) }, boundary + 3_600_000, null)?.word, "Rebuild due");
  assert.equal(imageStatus({ ...kind, builtAt: at(boundary + 60_000) }, boundary + 3_600_000, null)?.word, "Fresh");
});

test("a failed rebuild never says jobs stopped while an image still serves them", () => {
  const failed = { ...kind, buildFailedAt: ago(60_000) };
  assert.match(imageStatus({ ...failed, builtAt: null }, now, null)?.sentence ?? "", /^Jobs still run on the current one\./);
  assert.match(imageStatus({ ...failed, image: null, builtAt: null }, now, null)?.sentence ?? "", /^These runners take no jobs/);
});

test("a build in progress says how far it is against its typical length, and never claims done", () => {
  const building = { ...kind, building: "app-ci:bbbbbbbbbbbb", buildingSince: ago(2 * 60_000) };
  assert.equal(imageStatus(building, now, 6 * 60_000)?.sentence, "2m in, typically 6m. Jobs keep the current image until it's done.");
  assert.equal(imageStatus({ ...building, buildingSince: ago(20 * 60_000) }, now, 6 * 60_000)?.progress, 0.95);
  assert.equal(imageStatus(building, now, null)?.progress, null);
});
