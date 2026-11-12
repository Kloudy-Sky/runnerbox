import assert from "node:assert/strict";
import { test } from "node:test";
import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { ADVICE } from "./advice.ts";
import { buildInbox, deriveInbox } from "./derive.ts";
import type { InboxInput } from "./rules.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const minutes = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

let nextId = 1;
function job(overrides: Partial<JobRecord> & { at?: number; ms?: number } = {}): JobRecord {
  // A retry starts after the attempt before it, as it would in GitHub.
  const { at = NOW - minutes(60) + ((overrides.attempt ?? 1) - 1) * minutes(10), ms = minutes(5), ...rest } = overrides;
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
  items.filter((item) => item.kind === "failure").map((item) => [item.verdict, item.quiet ?? "needs_you"]);

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
    ["flaky", "flaky"],
    ["code", "own_code"],
    ["unconfirmed", "failed_once"],
  ]);
  assert.equal(items[0]!.title, "ci / e2e fails on this machine, not in its code");
  assert.equal(items[0]!.why, "The job's container was stopped for using too much memory. That points at the machine, not the code.");
  assert.equal(items[0]!.happened, "ci / e2e failed once in 1 run, on example-linux. A retry on the same run passed.");
  // The exact figures stay in the evidence.
  assert.match(items[0]!.evidence.reasons[0]!, /exit code 137, which means it was killed for using too much memory/);
  assert.equal(items[0]!.action, ADVICE.memory);
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
  assert.equal(items[0]!.why, "The VM ran out of memory while this job ran. That points at the machine, not the code.");
  assert.deepEqual(items[0]!.evidence.reasons, ["the VM had only 0.29 GiB of its 8 GiB free"]);
  assert.equal(items[0]!.evidence.machine?.vmLowMiB, 300);
});

test("a job flaky three times needs a look, and a failure fixed by a later run doesn't", () => {
  const flaky = [1, 2, 3].flatMap((runId) => [
    job({ job: "lint", runId, conclusion: "failure", at: NOW - minutes(runId * 10) }),
    job({ job: "lint", runId, attempt: 2, at: NOW - minutes(runId * 10) + minutes(5) }),
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
  assert.match(byVerdict.flaky!.happened, /in 3 of 3 runs/);
  assert.equal(byVerdict.infra?.quiet, "resolved");
  assert.match(byVerdict.infra!.happened, /later run on this branch passed/);
  assert.equal(byVerdict.infra!.action, "Nothing to do now. If it fails this way again, it comes back here.");
});

test("jobs that waited too long merge into one item across repositories and labels, and short waits don't count", () => {
  const starved = (overrides: Partial<JobRecord> & { at?: number; ms?: number }) => {
    const { at = NOW - minutes(30), ms = minutes(20), ...rest } = overrides;
    // No runner, so the whole time from creation to the end was spent waiting.
    return job({ runner: null, conclusion: "cancelled", createdAt: iso(at), startedAt: iso(at), completedAt: iso(at + ms), ...rest });
  };
  const jobs = [
    // Ran here, which is how the machine is known to serve example-linux and example-docker.
    job({ runner: "example-linux-1-1780000000" }),
    job({ runner: "example-docker-1-1780000000", labels: ["self-hosted", "example-docker"] }),
    starved({}),
    starved({}),
    starved({ repo: "owner/other", labels: ["self-hosted", "example-docker"] }),
    // Cancelled seconds after it was created: superseded by a newer push, not left waiting.
    starved({ ms: 4_000 }),
    starved({ repo: "owner/old", at: NOW - 3 * 24 * minutes(60) }),
    // A label for GitHub's machines, which no runner here could have taken.
    starved({ repo: "owner/hosted", labels: ["ubuntu-24.04"] }),
  ];
  const events: LauncherEvent[] = [
    { install: "example", event: "runner", slot: 1, runner: "example-linux-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: minutes(6) },
    { install: "example", event: "runner", slot: 1, runner: "example-docker-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: minutes(6) },
    { install: "example", event: "memory_wait", slot: 1, startedAt: iso(NOW - minutes(40)), durationMs: minutes(30) },
  ];
  const items = deriveInbox(input({ jobs, events })).filter((item) => item.kind === "no_runner");
  assert.deepEqual(items.map((item) => [item.quiet ?? "needs_you", item.evidence.attempts.length]).toSorted(), [
    ["needs_you", 3],
    ["other_runners", 1],
    ["resolved", 1],
  ]);
  const [waiting] = items;
  assert.equal(waiting!.title, "Jobs are waiting too long for a runner");
  assert.equal(waiting!.happened, "3 jobs waited more than 5 minutes for one of your runners and ended without getting one. Most were on example-linux.");
  assert.match(waiting!.why, /short of free memory once/);
  assert.equal(waiting!.repo, null);
  assert.deepEqual(waiting!.evidence.breakdown.map((part) => [part.label, part.count]), [
    ["owner/name, example-linux", 2],
    ["owner/other, example-docker", 1],
  ]);
  assert.match(items.find((item) => item.quiet === "other_runners")!.why, /another machine or to GitHub's machines/);
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
  assert.deepEqual(items.map((item) => item.title), ["The linux runners keep failing before they take a job"]);
  assert.equal(items[0]!.happened, "On slot 1, the last 3 runners stopped with exit 125.");
  assert.match(items[0]!.why, /Docker couldn't start the container/);
  // A second failing slot of the same kind is the same problem: one item, both slots in the breakdown.
  const both = deriveInbox(input({ events: [...events, ...[4, 5, 6].map((minute) => runnerEvent(2, minute, 125))] })).filter((item) => item.kind === "failing_slot");
  assert.equal(both.length, 1);
  assert.deepEqual(both[0]!.evidence.breakdown.map((part) => [part.label, part.count]), [
    ["slot 1", 3],
    ["slot 2", 3],
  ]);
});

test("a slow run is noted, and three slow runs in a row need you", () => {
  const history = (count: number, slowTail: number) =>
    Array.from({ length: count }, (_, index) =>
      job({ runId: index + 1, at: NOW - minutes(count - index) * 60, ms: index >= count - slowTail ? minutes(12) : minutes(5) }),
    );
  const once = deriveInbox(input({ jobs: history(8, 1) })).filter((item) => item.kind === "slow_job");
  assert.deepEqual(once.map((item) => item.quiet), ["slow"]);
  assert.equal(once[0]!.happened, "Its latest run took 12 minutes, against a typical 5 minutes.");
  const regression = deriveInbox(input({ jobs: history(10, 3) })).filter((item) => item.kind === "slow_job");
  assert.deepEqual(regression.map((item) => item.group), ["needs_you"]);
  assert.equal(regression[0]!.title, "ci / test has become slower on example-linux");
});

test("a job whose runs fall in two clusters isn't slow when it lands in the upper one", () => {
  // Most runs take 5 minutes; some rebuild a cache and take 12. A 12-minute run is one of those.
  const lengths = [5, 5, 12, 5, 5, 12, 5, 12, 5, 12];
  const jobs = lengths.map((length, index) => job({ runId: index + 1, at: NOW - minutes(lengths.length - index) * 60, ms: minutes(length) }));
  assert.deepEqual(deriveInbox(input({ jobs })).filter((item) => item.kind === "slow_job"), []);
  // The same history with a 25-minute run is still slow.
  const slower = [...jobs.slice(0, -1), job({ runId: 99, at: NOW - minutes(30), ms: minutes(25) })];
  assert.equal(deriveInbox(input({ jobs: slower })).filter((item) => item.kind === "slow_job").length, 1);
});

test("the inbox leads with a headline, lists what needs the owner, and counts the rest by kind", () => {
  const jobs = [
    // On this machine: one passes, and two fail once each with nothing pointing at the machine.
    job({ job: "build", runId: 1, ms: minutes(60) }),
    job({ job: "lint", runId: 2, conclusion: "failure" }),
    job({ job: "docs", runId: 3, conclusion: "failure" }),
    // On GitHub's machines, waiting 30 seconds for one.
    job({ job: "check", runId: 4, labels: ["ubuntu-24.04"], runner: "GitHub Actions 2", ms: minutes(120), createdAt: iso(NOW - minutes(60) - 30_000) }),
  ];
  const { summary, items, quiet } = buildInbox(input({ jobs }), 7);
  assert.equal(summary.headline, "Nothing needs you. CI looks healthy.");
  assert.deepEqual(summary.facts, [
    "4 jobs ran in the last 7 days.",
    "50 in 100 passed.",
    "A typical job waited 10 seconds for a runner.",
    "1 hour on your machines, 2 hours on GitHub's machines.",
  ]);
  assert.deepEqual(items, []);
  assert.deepEqual(quiet.map((group) => [group.kind, group.title, group.items.length]), [["failed_once", "2 one-off failures", 2]]);
});

test("attempts on one commit are judged together across runs and runner types, and old records group by run", () => {
  const sha = "3b8ac79e0f1d2c3b4a5968778695a4b3c2d1e0f9";
  const hosted = ["ubuntu-24.04"];
  const items = deriveInbox(
    input({
      jobs: [
        // One commit: failed self-hosted in one run, passed hosted in another, so it's flaky.
        job({ job: "lint", runId: 1, headSha: sha, conclusion: "failure" }),
        job({ job: "lint", runId: 2, headSha: sha, labels: hosted, runner: "GitHub Actions 3", at: NOW - minutes(30) }),
        // Another commit: failed on both runner types in separate runs, so it's the code.
        job({ job: "build", runId: 3, headSha: "a".repeat(40), conclusion: "failure" }),
        job({ job: "build", runId: 4, headSha: "a".repeat(40), labels: hosted, runner: "GitHub Actions 4", conclusion: "failure", at: NOW - minutes(30) }),
        // No commit recorded: two runs stay two units of one attempt each.
        job({ job: "docs", runId: 5, conclusion: "failure" }),
        job({ job: "docs", runId: 6, conclusion: "failure", at: NOW - minutes(30) }),
      ],
    }),
  );
  const byJob = Object.fromEntries(items.filter((item) => item.kind === "failure").map((item) => [item.title.split(" ")[2] ?? "", item] as const));
  assert.equal(byJob.lint?.verdict, "flaky");
  assert.match(byJob.lint!.evidence.reasons[0]!, /same commit/);
  assert.deepEqual(byJob.lint!.evidence.attempts.map((attempt) => [attempt.runId, attempt.runnerType, attempt.conclusion]), [
    [1, "example-linux", "failure"],
    [2, "ubuntu-24.04", "success"],
  ]);
  assert.equal(byJob.build?.verdict, "code");
  assert.match(byJob.build!.happened, /example-linux and ubuntu-24.04/);
  assert.equal(byJob.docs?.verdict, "unconfirmed");
});

test("when every runner fails and no job runs, the headline leads with what needs you", () => {
  const runnerEvent = (minute: number): LauncherEvent => ({
    install: "example",
    runnerType: "linux",
    event: "runner",
    slot: 1,
    runner: `example-linux-1-${minute}`,
    startedAt: iso(NOW - minutes(60 - minute)),
    durationMs: 2000,
    exitCode: 125,
    released: false,
  });
  const { summary, items } = buildInbox(input({ events: [1, 2, 3].map(runnerEvent) }), 7);
  assert.equal(items.length, 1);
  assert.equal(summary.headline, "1 thing needs you.");
});

test("a wait names the label most jobs were on only when it has most of them, and old waits stay until a runner comes", () => {
  const starved = (repo: string, label: string, at = NOW - minutes(30)) =>
    job({ repo, runner: null, conclusion: "cancelled", labels: ["self-hosted", label], createdAt: iso(at), startedAt: iso(at), completedAt: iso(at + minutes(20)) });
  const serves = [job({ labels: ["self-hosted", "example-linux"] }), job({ labels: ["self-hosted", "example-docker"], runner: "example-docker-1-1780000000" })];
  const events: LauncherEvent[] = [
    { install: "example", event: "runner", slot: 1, runner: "example-linux-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: 1 },
    { install: "example", event: "runner", slot: 1, runner: "example-docker-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: 1 },
  ];
  const happened = (jobs: JobRecord[]) => deriveInbox(input({ jobs: [...serves, ...jobs], events })).find((item) => item.kind === "no_runner")!.happened;
  // 3 on linux in one repository, 4 on docker across two: docker has most.
  const mixed = [...[1, 2, 3].map(() => starved("owner/a", "example-linux")), ...[1, 2].flatMap(() => [starved("owner/b", "example-docker"), starved("owner/c", "example-docker")])];
  assert.match(happened(mixed), /Most were on example-docker\.$/);
  assert.match(happened([starved("owner/a", "example-linux"), starved("owner/b", "example-docker")]), /They were on example-linux and example-docker\.$/);

  // Three days old, with no job on its label getting a runner since: it still needs you.
  const old = starved("owner/a", "example-linux", NOW - 3 * 24 * minutes(60));
  const servedBefore = job({ labels: ["self-hosted", "example-linux"], at: NOW - 4 * 24 * minutes(60) });
  assert.equal(deriveInbox(input({ jobs: [servedBefore, old], events })).find((item) => item.kind === "no_runner")?.group, "needs_you");
});

test("a frequent flake a later run fixed is quiet, and says there's nothing to do", () => {
  const flaky = [1, 2, 3].flatMap((runId) => [
    job({ job: "lint", runId, conclusion: "failure", at: NOW - minutes(runId * 10 + 60) }),
    job({ job: "lint", runId, attempt: 2, at: NOW - minutes(runId * 10 + 60) + minutes(5) }),
  ]);
  const later = job({ job: "lint", runId: 9, at: NOW - minutes(5) });
  const item = deriveInbox(input({ jobs: [...flaky, later] })).find((each) => each.verdict === "flaky")!;
  assert.equal(item.quiet, "resolved");
  assert.equal(item.action, "Nothing to do now. If it fails this way again, it comes back here.");
});

test("a machine failure's Why is one plain sentence, and its figures stay in the evidence", () => {
  const runner = "example-linux-3-1780000000";
  const failed = job({ conclusion: "failure", runner });
  const events: LauncherEvent[] = [{ install: "example", event: "runner", slot: 3, runner, startedAt: iso(NOW), durationMs: 1, exitCode: 137, released: false }];
  const [item] = deriveInbox(input({ jobs: [failed], events, machine: (candidate) => (candidate === failed ? { samples: 4, vmLowMiB: 574, vmTotalMiB: 16384 } : undefined) }));
  assert.equal(item!.why, "The VM ran out of memory while this job ran, and the job's container was stopped for it. That points at the machine, not the code.");
  assert.deepEqual(item!.evidence.reasons, ["the VM had only 0.56 GiB of its 16 GiB free", "its container stopped with exit code 137, which means it was killed for using too much memory"]);
});
