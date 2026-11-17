import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inbox, InboxItem } from "@runnerbox/contracts";
import { needsYouEverywhere } from "./needsYouEverywhere.ts";

const evidence = { steps: [], attempts: [], machine: null, launcher: [], durations: [], reasons: [], breakdown: [] };
const item = (id: string, kind: InboxItem["kind"], at: string, happened = ""): InboxItem => ({
  id, kind, group: "needs_you", quiet: null, verdict: null, repo: "owner/name", install: null,
  title: id, happened, why: "", action: "", at, evidence,
});
const inbox = (...items: InboxItem[]): Inbox => ({
  summary: { needYou: items.length, jobs: 0, passRate: null, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, headline: "", facts: [] },
  items,
  quiet: [],
});

test("a failure two machines both report counts once, told by the machine that saw it last", () => {
  const items = needsYouEverywhere([
    { environmentId: "a", inbox: inbox(item("failure:e2e:infra", "failure", "2026-11-17T10:00:00Z", "seen first")) },
    { environmentId: "b", inbox: inbox(item("failure:e2e:infra", "failure", "2026-11-17T10:30:00Z", "seen last")) },
  ]);
  assert.deepEqual(items.map((each) => each.happened), ["seen last"]);
});

test("each machine's own problem counts, even when the two share an id", () => {
  const items = needsYouEverywhere([
    { environmentId: "a", inbox: inbox(item("no_runner:needs_you", "no_runner", "2026-11-17T10:00:00Z")) },
    { environmentId: "b", inbox: inbox(item("no_runner:needs_you", "no_runner", "2026-11-17T10:05:00Z")) },
  ]);
  assert.equal(items.length, 2);
});

test("a machine with no answer hides nothing the others report", () => {
  const items = needsYouEverywhere([
    { environmentId: "a", inbox: undefined },
    { environmentId: "b", inbox: inbox(item("failure:lint:infra", "failure", "2026-11-17T10:00:00Z")) },
  ]);
  assert.deepEqual(items.map((each) => each.id), ["failure:lint:infra"]);
});
