import assert from "node:assert/strict";
import { test } from "node:test";
import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { deriveInbox, type InboxInput } from "./rules.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const minutes = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

let nextId = 1;
function job(overrides: Partial<JobRecord> & { at?: number; ms?: number } = {}): JobRecord {
  const { at = NOW - minutes(60), ms = minutes(5), ...rest } = overrides;
  return {
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
    completedAt: iso(at + ms),
    steps: [{ name: "Test", conclusion: "success", ms }],
    ...rest,
  };
}

const input = (overrides: Partial<InboxInput>): InboxInput => ({
  now: NOW,
  jobs: [],
  machine: () => undefined,
  events: [],
  installs: [],
  ...overrides,
});

const failures = (items: ReturnType<typeof deriveInbox>) =>
  items.filter((item) => item.kind === "failure").map((item) => [item.verdict, item.group]);

test("a failure gets a verdict, and only the machine's failures need the runner owner", () => {
  const runner = "example-linux-3-1780000000";
  const events: LauncherEvent[] = [
    { install: "example", event: "runner", slot: 3, runner, startedAt: iso(NOW), durationMs: 1, exitCode: 137, released: false },
  ];
  const items = deriveInbox(
    input({
      events,
      jobs: [
        // Passed on retry.
        job({ job: "lint", runId: 1, conclusion: "failure" }),
        job({ job: "lint", runId: 1, attempt: 2 }),
        // Failed on both attempts.
        job({ job: "build", runId: 2, conclusion: "failure" }),
        job({ job: "build", runId: 2, attempt: 2, conclusion: "failure" }),
        // One attempt, nothing else known.
        job({ job: "docs", runId: 3, conclusion: "failure" }),
        // Passed on retry, but the container died under the first attempt.
        job({ job: "e2e", runId: 4, conclusion: "failure", runner }),
        job({ job: "e2e", runId: 4, attempt: 2 }),
      ],
    }),
  );
  assert.deepEqual(failures(items), [
    ["infra", "needs_you"],
    ["flaky", "no_action"],
    ["code", "no_action"],
    ["unconfirmed", "no_action"],
  ]);
  assert.match(items[0]!.detail, /container exited 137/);
});

test("low memory during a failed job points at the machine", () => {
  const failed = job({ conclusion: "failure" });
  const items = deriveInbox(
    input({
      jobs: [failed],
      machine: (candidate) => (candidate === failed ? { samples: 4, vmLowMiB: 300, vmTotalMiB: 8192 } : undefined),
    }),
  );
  assert.deepEqual(failures(items), [["infra", "needs_you"]]);
  assert.equal(items[0]!.evidence.machine?.vmLowMiB, 300);
});

test("a job flaky three times needs a look, and a failure fixed by a later run doesn't", () => {
  const flaky = [1, 2, 3].flatMap((runId) => [
    job({ job: "lint", runId, conclusion: "failure", at: NOW - minutes(runId * 10) }),
    job({ job: "lint", runId, attempt: 2, at: NOW - minutes(runId * 10) }),
  ]);
  const runner = "example-linux-3-1780000000";
  const fixed = [
    job({ job: "e2e", runId: 9, conclusion: "failure", runner, at: NOW - minutes(120) }),
    job({ job: "e2e", runId: 10, at: NOW - minutes(60) }),
  ];
  const events: LauncherEvent[] = [
    { install: "example", event: "runner", slot: 3, runner, startedAt: iso(NOW), durationMs: 1, exitCode: null, released: false },
  ];
  const items = deriveInbox(input({ jobs: [...flaky, ...fixed], events }));
  const byVerdict = Object.fromEntries(items.filter((item) => item.kind === "failure").map((item) => [item.verdict, item]));
  assert.equal(byVerdict.flaky?.group, "needs_you");
  assert.match(byVerdict.flaky!.detail, /^3 of 3 runs/);
  assert.equal(byVerdict.infra?.group, "no_action");
  assert.match(byVerdict.infra!.detail, /later run on this branch passed/);
});

test("jobs that never got a runner need you while recent, with memory waits as the reason", () => {
  const waiting = job({ runner: null, conclusion: "cancelled", at: NOW - minutes(30), ms: minutes(20) });
  const old = job({ repo: "owner/other", runner: null, conclusion: "cancelled", at: NOW - 3 * 24 * minutes(60) });
  const events: LauncherEvent[] = [
    { install: "example", event: "memory_wait", slot: 1, startedAt: iso(NOW - minutes(40)), durationMs: minutes(30) },
  ];
  const items = deriveInbox(input({ jobs: [waiting, old], events })).filter((item) => item.kind === "no_runner");
  assert.deepEqual(
    items.map((item) => [item.repo, item.group]),
    [
      ["owner/name", "needs_you"],
      ["owner/other", "no_action"],
    ],
  );
  assert.match(items[0]!.detail, /waiting for memory once/);
});

test("a slot whose last three runners failed is reported, and a success ends the streak", () => {
  const runnerEvent = (slot: number, minute: number, exitCode: number | null): LauncherEvent => ({
    install: "example",
    runnerType: "linux",
    event: "runner",
    slot,
    runner: `example-linux-${slot}-${minute}`,
    startedAt: iso(NOW - minutes(60 - minute)),
    durationMs: 2000,
    exitCode,
    released: false,
  });
  const events = [
    ...[1, 2, 3].map((minute) => runnerEvent(1, minute, 125)),
    ...[1, 2].map((minute) => runnerEvent(2, minute, 125)),
    runnerEvent(2, 3, 0),
  ];
  const items = deriveInbox(input({ events })).filter((item) => item.kind === "failing_slot");
  assert.deepEqual(items.map((item) => item.title), ["Slot 1 of linux keeps failing"]);
  assert.match(items[0]!.detail, /last 3 runners exited 125/);
});

test("a slow run is noted, and three slow runs in a row need you", () => {
  const history = (count: number, slowTail: number) =>
    Array.from({ length: count }, (_, index) =>
      job({ runId: index + 1, at: NOW - minutes(count - index) * 60, ms: index >= count - slowTail ? minutes(12) : minutes(5) }),
    );
  const once = deriveInbox(input({ jobs: history(8, 1) })).filter((item) => item.kind === "slow_job");
  assert.deepEqual(once.map((item) => item.group), ["no_action"]);
  assert.match(once[0]!.detail, /^12m 00s against a median of 5m 00s/);
  const regression = deriveInbox(input({ jobs: history(10, 3) })).filter((item) => item.kind === "slow_job");
  assert.deepEqual(regression.map((item) => item.group), ["needs_you"]);
});
