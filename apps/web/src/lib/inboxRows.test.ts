import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inbox, InboxCostLevel, InboxItem } from "@runnerbox/contracts";
import { inboxRows } from "./inboxRows.ts";

const evidence = { steps: [], attempts: [], machine: null, launcher: [], durations: [], reasons: [], breakdown: [] };
const item = (id: string, at: string, level?: InboxCostLevel): InboxItem => ({
  id, kind: "failure", group: "needs_you", quiet: null, verdict: "infra", repo: "owner/name", install: null,
  title: id, happened: "", why: "", action: "", at, evidence,
  ...(level ? { cost: { level, text: level } } : {}),
});
const inbox = (...items: InboxItem[]): Inbox => ({
  summary: { needYou: items.length, jobs: 0, passRate: null, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, headline: "", facts: [] },
  items,
  quiet: [],
});

test("a failure two machines report is one row holding both machines' copies, so a write reaches each", () => {
  const rows = inboxRows([
    { environmentId: "a", inbox: inbox(item("failure:e2e:infra", "2026-11-17T10:00:00Z")) },
    { environmentId: "b", inbox: inbox(item("failure:e2e:infra", "2026-11-17T10:30:00Z")) },
  ]);
  assert.equal(rows.needsYou.length, 1);
  assert.deepEqual(rows.needsYou[0]?.copies.map((copy) => copy.environmentId), ["a", "b"]);
});

test("a machine's own kind of item stays its own row, even under the same id, so a write reaches only that machine", () => {
  const waited = { ...item("no_runner:needs_you", "2026-11-17T10:00:00Z"), kind: "no_runner" as const };
  const rows = inboxRows([
    { environmentId: "a", inbox: inbox(waited) },
    { environmentId: "b", inbox: inbox(waited) },
  ]);
  assert.deepEqual(rows.needsYou.map((row) => row.copies.map((copy) => copy.environmentId)), [["a"], ["b"]]);
});

test("what needs you is sorted by cost across machines, blocking first", () => {
  const rows = inboxRows([
    { environmentId: "a", inbox: inbox(item("nothing", "2026-11-17T10:00:00Z", "nothing_yet"), item("uncosted", "2026-11-17T10:00:00Z")) },
    { environmentId: "b", inbox: inbox(item("slower", "2026-11-17T10:00:00Z", "slower"), item("blocking", "2026-11-17T10:00:00Z", "blocking")) },
  ]);
  assert.deepEqual(rows.needsYou.map((row) => row.id), ["blocking", "slower", "nothing", "uncosted"]);
});

test("snoozed and settled items leave what needs you for their shelves", () => {
  const state = (status: "snoozed" | "settled") => ({ status, snoozedUntil: null, wokeAt: null, settledAt: null });
  const rows = inboxRows([
    { environmentId: "a", inbox: inbox({ ...item("snoozed", "2026-11-17T10:00:00Z"), state: state("snoozed") }, { ...item("settled", "2026-11-17T10:00:00Z"), state: state("settled") }, item("open", "2026-11-17T10:00:00Z")) },
  ]);
  assert.deepEqual(rows.needsYou.map((row) => row.id), ["open"]);
  assert.deepEqual(rows.snoozed.map((row) => row.id), ["snoozed"]);
  assert.deepEqual(rows.settled.map((row) => row.id), ["settled"]);
});
