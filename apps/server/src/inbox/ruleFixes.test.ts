import assert from "node:assert/strict";
import { test } from "node:test";
import type { Proposal } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { Proposals } from "../proposals/Proposals.ts";
import { deriveInbox } from "./derive.ts";
import { withFixes } from "./fixes.ts";
import { Inbox } from "./Inbox.ts";
import { DAY_MS } from "./jobs.ts";
import type { InboxInput } from "./rules.ts";
import * as RuleFixes from "./RuleFixes.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const failed = (jobId: number, runner: string): JobRecord => ({
  v: 1,
  repo: "owner/name",
  workflow: "ci",
  job: "e2e",
  jobId,
  runId: 100 + jobId,
  attempt: 1,
  branch: "main",
  conclusion: "failure",
  runner,
  labels: ["self-hosted", "example-linux"],
  createdAt: iso(NOW - jobId * 60_000 - 10_000),
  startedAt: iso(NOW - jobId * 60_000),
  completedAt: iso(NOW - jobId * 60_000 + 30_000),
  steps: [],
});

// e2e stopped 3 times for using too much memory on the example install's linux kind.
const runners = [1, 2, 3].map((n) => `example-linux-${n}-1780000000`);
const input: InboxInput = {
  now: NOW,
  jobs: runners.map((runner, index) => failed(index + 1, runner)),
  machine: () => undefined,
  events: runners.map((runner, index) => ({ install: "example", event: "runner", runnerType: "linux", slot: index + 1, runner, startedAt: iso(NOW), durationMs: 1, exitCode: 137, released: false })),
  installs: [],
};
const items = deriveInbox(input);
const item = items.find((each) => each.kind === "failure")!;

const proposal = (fields: Partial<Proposal>): Proposal => ({
  id: "0000000000000000",
  install: "example",
  changes: [{ path: "runners.linux.slots", from: 4, to: 3 }],
  reason: "",
  threadId: null,
  runUrl: null,
  revertOf: null,
  createdAt: iso(Date.now()),
  expiresAt: iso(Date.now() + DAY_MS),
  hash: "",
  status: "open",
  decidedBy: null,
  decidedAt: null,
  when: null,
  outcome: null,
  ...fields,
});

// Proposals kept in memory, for an install whose linux kind runs `slots` runners.
function fakeProposals(slots: number, stored: Proposal[] = []) {
  const layer = Layer.succeed(
    Proposals,
    Proposals.of({
      settings: (install) => Effect.succeed({ ok: true as const, install, fields: [{ path: "runners.linux.slots", value: slots, min: 1, max: slots * 2, unit: "slots" as const }], pending: null }),
      propose: (input) =>
        Effect.sync(() => {
          const made = proposal({ ...input, id: String(stored.length).padStart(16, "0"), changes: input.changes.map((change) => ({ ...change, from: slots })) });
          stored.push(made);
          return made;
        }),
      list: Effect.sync(() => [...stored]),
      approve: () => Effect.die("unused"),
      decline: () => Effect.die("unused"),
      revert: () => Effect.die("unused"),
    }),
  );
  return { stored, layer };
}

// An inbox that always derives the items above.
const inbox = Layer.succeed(Inbox, Inbox.of({ list: () => Effect.die("unused"), derived: () => Effect.succeed({ input, items }) }));

// One of the server's passes. Its own loop also makes one as it starts; passes take turns, so the
// outcome is the same.
const pass = (layer: Layer.Layer<Proposals>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixes = yield* RuleFixes.RuleFixes;
      yield* fixes.check;
    }).pipe(Effect.provide(RuleFixes.layer.pipe(Layer.provide(Layer.merge(layer, inbox))))),
  );
const fixOf = (stored: ReadonlyArray<Proposal>) => withFixes(items, stored).find((each) => each.id === item.id)?.fix;

test("a kind that ran out of memory with 4 runners at once is proposed 3, as the rule's", async () => {
  const { stored, layer } = fakeProposals(4);
  await pass(layer);
  assert.equal(stored.length, 1);
  const [made] = stored;
  assert.deepEqual(made!.changes, [{ path: "runners.linux.slots", from: 4, to: 3 }]);
  assert.deepEqual([made!.threadId, made!.rule], [null, { itemId: item.id }]);
  assert.equal(made!.reason, "The ci / e2e check failed 3 times when example ran out of memory running up to 4 jobs at once. Running 3 at a time leaves it room.");
  assert.deepEqual(fixOf(stored), { proposalId: made!.id });
});

test("a kind with one runner gets no proposal", async () => {
  const { stored, layer } = fakeProposals(1);
  await pass(layer);
  assert.equal(stored.length, 0);
});

test("an open proposal for an item blocks a second one", async () => {
  const { stored, layer } = fakeProposals(4);
  await pass(layer);
  await pass(layer);
  assert.equal(stored.length, 1);
});

test("after the owner declines a fix or lets it expire, the rule waits 7 days to propose it again", async () => {
  const ended = (daysAgo: number) => [
    proposal({ rule: { itemId: item.id }, status: "declined", decidedBy: "owner", decidedAt: iso(Date.now() - daysAgo * DAY_MS) }),
    proposal({ rule: { itemId: item.id }, status: "expired", expiresAt: iso(Date.now() - daysAgo * DAY_MS) }),
  ];
  for (const each of [...ended(6), ...ended(8)]) {
    const daysAgo = (Date.now() - Date.parse(each.decidedAt ?? each.expiresAt)) / DAY_MS;
    const { stored, layer } = fakeProposals(4, [each]);
    await pass(layer);
    assert.equal(stored.length, daysAgo < 7 ? 1 : 2, `${each.status} ${Math.round(daysAgo)} days ago`);
  }
});
