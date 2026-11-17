import assert from "node:assert/strict";
import { test } from "node:test";
import { type InboxItem, isInboxItemHidden } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { deriveInbox } from "./derive.ts";
import { blankState, itemState, snooze, type StoredItemState, unsettle } from "./itemState.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const minutes = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

let nextId = 1;
const job = ({ at, ...rest }: Partial<JobRecord> & { at: number }): JobRecord => ({
  v: 1,
  repo: "owner/name",
  workflow: "ci",
  job: "test",
  jobId: nextId++,
  runId: 100,
  attempt: 1,
  branch: "main",
  conclusion: "success",
  runner: "example-linux-1-1780000000",
  labels: ["self-hosted", "example-linux"],
  createdAt: iso(at - 10_000),
  startedAt: iso(at),
  completedAt: iso(at + minutes(5)),
  steps: [{ name: "Test", conclusion: "success", ms: minutes(5) }],
  ...rest,
});

const failureItem = (jobs: JobRecord[]): InboxItem => {
  const items = deriveInbox({ now: NOW, jobs, machine: () => undefined, events: [], installs: [] }).filter((item) => item.kind === "failure");
  assert.equal(items.length, 1);
  return items[0]!;
};

// Failed then passed on the same commit, an hour ago.
const flaky = [job({ at: NOW - minutes(60), headSha: "a", conclusion: "failure" }), job({ at: NOW - minutes(50), headSha: "a", attempt: 2 })];
// Snoozed half an hour ago, until an hour from now.
const snoozed: StoredItemState = snooze(blankState(iso(NOW)), iso(NOW + minutes(60)), iso(NOW - minutes(30)));

test("a snoozed item stays hidden until its time", () => {
  const item = failureItem(flaky);
  const before = itemState(snoozed, item, NOW);
  assert.equal(before.status, "snoozed");
  assert.ok(isInboxItemHidden({ ...item, state: before }));
  const after = itemState(snoozed, item, NOW + minutes(61));
  assert.deepEqual([after.status, after.wokeAt], ["back", iso(NOW + minutes(60))]);
  assert.ok(!isInboxItemHidden({ ...item, state: after }));
});

test("a snoozed item wakes early when it fails again", () => {
  const item = failureItem([...flaky, job({ at: NOW - minutes(10), runId: 101, headSha: "b", conclusion: "failure" }), job({ at: NOW - minutes(5), runId: 101, headSha: "b", attempt: 2 })]);
  assert.equal(item.id, failureItem(flaky).id);
  const state = itemState(snoozed, item, NOW);
  assert.deepEqual([state.status, state.wokeAt], ["back", iso(NOW - minutes(5))]);
});

test("a passing run doesn't wake a snoozed item", () => {
  // Another passing attempt on the same commit moves the item's time, but isn't a failure.
  const item = failureItem([...flaky, job({ at: NOW - minutes(10), headSha: "a", attempt: 3 })]);
  assert.equal(item.at, iso(NOW - minutes(5)));
  assert.equal(itemState(snoozed, item, NOW).status, "snoozed");
});

// Failed in its own code on both attempts, then a later run on the branch passed.
const fixed = [
  job({ at: NOW - minutes(60), headSha: "a", conclusion: "failure" }),
  job({ at: NOW - minutes(50), headSha: "a", attempt: 2, conclusion: "failure" }),
  job({ at: NOW - minutes(20), runId: 101, headSha: "b" }),
];

test("a failure a later run fixed settles on its own", () => {
  const item = failureItem(fixed);
  assert.equal(item.quiet, "resolved");
  assert.deepEqual(itemState(undefined, item, NOW), { status: "settled", snoozedUntil: null, wokeAt: null, settledAt: null });
});

test("unsettling keeps a fixed failure in the list", () => {
  const item = failureItem(fixed);
  assert.equal(itemState(unsettle(blankState(iso(NOW)), iso(NOW - minutes(10))), item, NOW).status, "active");
});
