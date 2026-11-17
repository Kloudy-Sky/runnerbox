import assert from "node:assert/strict";
import { test } from "node:test";
import type { Inbox, InboxItem } from "@runnerbox/contracts";
import { needsYouEverywhere } from "./needsYouEverywhere.ts";

const evidence = { steps: [], attempts: [], machine: null, launcher: [], durations: [], reasons: [], breakdown: [] };
const item = (id: string, at: string, happened = ""): InboxItem => ({
  id, kind: "failure", group: "needs_you", quiet: null, verdict: "infra", repo: "owner/name", install: null,
  title: id, happened, why: "", action: "", at, evidence,
});
const inbox = (...items: InboxItem[]): Inbox => ({
  summary: { needYou: items.length, jobs: 0, passRate: null, typicalWaitMs: null, ownMachinesMs: 0, githubMachinesMs: 0, headline: "", facts: [] },
  items,
  quiet: [],
});

test("a failure two machines both report counts once, told by the machine that saw it last", () => {
  const first = inbox(item("failure:e2e:infra", "2026-11-17T10:00:00Z", "seen first"), item("failing_slot:example:docker", "2026-11-17T09:00:00Z"));
  const second = inbox(item("failure:e2e:infra", "2026-11-17T10:30:00Z", "seen last"));
  const items = needsYouEverywhere([first, second]);
  assert.deepEqual(items.map((each) => each.id).toSorted(), ["failing_slot:example:docker", "failure:e2e:infra"]);
  assert.equal(items.find((each) => each.id === "failure:e2e:infra")?.happened, "seen last");
});

test("a machine with no answer hides nothing the others report", () => {
  assert.deepEqual(needsYouEverywhere([undefined, inbox(item("failure:lint:infra", "2026-11-17T10:00:00Z"))]).map((each) => each.id), ["failure:lint:infra"]);
});
