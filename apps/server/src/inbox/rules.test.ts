import assert from "node:assert/strict";
import { test } from "node:test";
import type { LauncherEvent } from "@runnerbox/contracts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
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
  assert.equal(items[0]!.title, "The ci / e2e check failed because example ran out of memory");
  assert.equal(items[0]!.happened, "The ci / e2e check failed once in 1 run. Memory ran out on example while it ran.");
  assert.equal(items[0]!.why, "The code isn't at fault. The same code passed when it ran again. You run example, so only a change on example fixes it.");
  assert.equal(items[0]!.action, "Run fewer jobs at once on example, so each one has the memory it needs.");
  // The exact figures stay in the evidence.
  assert.match(items[0]!.evidence.reasons[0]!, /exit code 137, which means it was killed for using too much memory/);
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
  assert.equal(items[0]!.happened, "The ci / test check failed once in 1 run. Memory ran out on this machine while it ran.");
  assert.deepEqual(items[0]!.evidence.reasons, ["the VM had 0.3 GB of its 8.0 GB free"]);
  assert.equal(items[0]!.evidence.machine?.vmLowMiB, 300);
});

test("a code failure a later run on its branch fixed is counted as fixed, not as failing", () => {
  const broken = [job({ job: "build", runId: 1, conclusion: "failure" }), job({ job: "build", runId: 1, attempt: 2, conclusion: "failure" })];
  const { quiet } = buildInbox(input({ jobs: [...broken, job({ job: "build", runId: 2, at: NOW - minutes(20) })] }), 7);
  assert.deepEqual(quiet.map((group) => group.title), ["1 problem already fixed"]);
  const [item] = quiet[0]!.items;
  assert.equal(item!.title, "The ci / build check failed in its own code, and a later run passed");
  assert.match(item!.happened, /A later run on this branch passed\.$/);
  assert.equal(item!.action, "Nothing to do now. If it fails this way again, it comes back here.");
  // Still broken: it stays a job failing in its own code.
  assert.deepEqual(buildInbox(input({ jobs: broken }), 7).quiet.map((group) => group.title), ["1 job failing in its own code"]);
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
    { install: "example", runnerType: "linux", event: "runner", slot: 1, runner: "example-linux-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: minutes(6) },
    { install: "example", runnerType: "docker", event: "runner", slot: 1, runner: "example-docker-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: minutes(6) },
    { install: "example", runnerType: "linux", event: "memory_wait", slot: 1, startedAt: iso(NOW - minutes(40)), durationMs: minutes(30) },
  ];
  const items = deriveInbox(input({ jobs, events })).filter((item) => item.kind === "no_runner");
  assert.deepEqual(items.map((item) => [item.quiet ?? "needs_you", item.evidence.attempts.length]).toSorted(), [
    ["needs_you", 3],
    ["other_runners", 1],
    ["resolved", 1],
  ]);
  const [waiting] = items;
  assert.equal(waiting!.title, "Jobs wait too long for a runner on example");
  assert.equal(waiting!.happened, "3 jobs waited more than 5 minutes for a runner and gave up.");
  assert.match(waiting!.why, /^Free memory on example was too low to start another runner for the whole time these jobs waited/);
  assert.equal(waiting!.repo, null);
  assert.deepEqual(waiting!.evidence.breakdown.map((part) => [part.label, part.count]), [
    ["owner/name, example-linux", 2],
    ["owner/other, example-docker", 1],
  ]);
  assert.match(items.find((item) => item.quiet === "other_runners")!.why, /another machine, or for one of GitHub's/);
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
  assert.deepEqual(items.map((item) => item.title), ["Runners on example keep failing before they take a job"]);
  assert.equal(items[0]!.happened, "One runner on example failed to start 3 times in a row, so no job reached it.");
  assert.equal(items[0]!.evidence.reasons[0], "The linux kind's runner 1 has failed to start 3 times in a row (exit 125).");
  // Killed for memory after starting: it didn't fail to start.
  const killed = deriveInbox(input({ events: [1, 2, 3].map((minute) => ({ ...runnerEvent(1, minute, 137) })) })).find((item) => item.kind === "failing_slot");
  assert.equal(killed?.happened, "One runner on example stopped before taking a job 3 times in a row, so no job reached it.");
  assert.match(items[0]!.why, /^Docker on example couldn't start the runner/);
  // A second failing slot of the same kind is the same problem: one item, both slots in the breakdown.
  const both = deriveInbox(input({ events: [...events, ...[4, 5, 6].map((minute) => runnerEvent(2, minute, 125))] })).filter((item) => item.kind === "failing_slot");
  assert.equal(both.length, 1);
  assert.deepEqual(both[0]!.evidence.breakdown.map((part) => [part.label, part.count]), [
    ["runner 1", 3],
    ["runner 2", 3],
  ]);
});

test("a slow run is noted, and three slow runs in a row need you", () => {
  const history = (count: number, slowTail: number) =>
    Array.from({ length: count }, (_, index) =>
      job({ runId: index + 1, at: NOW - minutes(count - index) * 60, ms: index >= count - slowTail ? minutes(12) : minutes(5) }),
    );
  const once = deriveInbox(input({ jobs: history(8, 1) })).filter((item) => item.kind === "slow_job");
  assert.deepEqual(once.map((item) => item.quiet), ["slow"]);
  assert.equal(once[0]!.happened, "Its latest run took 12 minutes, against a usual 5 minutes.");
  const regression = deriveInbox(input({ jobs: history(10, 3) })).filter((item) => item.kind === "slow_job");
  assert.deepEqual(regression.map((item) => item.group), ["needs_you"]);
  assert.equal(regression[0]!.title, "The ci / test check got slower on this machine");
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
  assert.equal(summary.headline, "Nothing needs you right now.");
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
  const byJob = Object.fromEntries(items.filter((item) => item.kind === "failure").map((item) => [item.title.split(" ")[3] ?? "", item] as const));
  assert.equal(byJob.lint?.verdict, "flaky");
  assert.match(byJob.lint!.evidence.reasons[0]!, /same commit/);
  assert.deepEqual(byJob.lint!.evidence.attempts.map((attempt) => [attempt.runId, attempt.runnerType, attempt.conclusion]), [
    [1, "example-linux", "failure"],
    [2, "ubuntu-24.04", "success"],
  ]);
  assert.equal(byJob.build?.verdict, "code");
  assert.match(byJob.build!.evidence.reasons.at(-1)!, /example-linux and ubuntu-24.04/);
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

test("an old wait stays until a runner comes", () => {
  const starved = (repo: string, label: string, at: number) =>
    job({ repo, runner: null, conclusion: "cancelled", labels: ["self-hosted", label], createdAt: iso(at), startedAt: iso(at), completedAt: iso(at + minutes(20)) });
  const events: LauncherEvent[] = [
    { install: "example", event: "runner", slot: 1, runner: "example-linux-1-1780000000", exitCode: 0, released: false, startedAt: iso(NOW - minutes(70)), durationMs: 1 },
  ];
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

test("a machine failure says what happened in plain words, and its figures stay in the evidence", () => {
  const runner = "example-linux-3-1780000000";
  const failed = job({ conclusion: "failure", runner });
  const events: LauncherEvent[] = [{ install: "example", event: "runner", slot: 3, runner, startedAt: iso(NOW), durationMs: 1, exitCode: 137, released: false }];
  const [item] = deriveInbox(input({ jobs: [failed], events, machine: (candidate) => (candidate === failed ? { samples: 4, vmLowMiB: 574, vmTotalMiB: 16384 } : undefined) }));
  assert.equal(item!.happened, "The ci / test check failed once in 1 run. Memory ran out on example while it ran.");
  assert.deepEqual(item!.evidence.reasons, ["the VM had 0.6 GB of its 16.0 GB free", "its container stopped with exit code 137, which means it was killed for using too much memory"]);
});

test("swapping alone reads as running short of memory, not as running out", () => {
  const failed = job({ conclusion: "failure" });
  const item = (machine: { vmLowMiB?: number; vmTotalMiB?: number; hostLowMiB?: number; hostTotalMiB?: number; vmSwapPeakMiB?: number }) =>
    deriveInbox(input({ jobs: [failed], machine: (candidate) => (candidate === failed ? { samples: 4, ...machine } : undefined) }))[0]!;
  assert.equal(item({ vmLowMiB: 300, vmTotalMiB: 8192, hostLowMiB: 500, hostTotalMiB: 32768 }).happened, "The ci / test check failed once in 1 run. Memory ran out on this machine while it ran.");
  const swapping = item({ vmLowMiB: 5120, vmTotalMiB: 16384, vmSwapPeakMiB: 1536 });
  assert.equal(swapping.title, "The ci / test check failed because this machine ran short of memory");
  assert.equal(swapping.happened, "The ci / test check failed once in 1 run. Memory ran short on this machine while it ran.");
  const [dry] = deriveInbox(input({ jobs: [failed], machine: (candidate) => (candidate === failed ? { samples: 4, vmLowMiB: 4, vmTotalMiB: 8192 } : undefined) }));
  assert.deepEqual(dry!.evidence.reasons, ["the VM had under 0.1 GB of its 8.0 GB free"]);
});

test("a check failing on an open pull request's head commit says it blocks it", () => {
  const sha = "c".repeat(40);
  const runner = "example-linux-3-1780000000";
  const events: LauncherEvent[] = [{ install: "example", event: "runner", slot: 3, runner, startedAt: iso(NOW), durationMs: 1, exitCode: 137, released: false }];
  const failed = job({ conclusion: "failure", runner, headSha: sha });
  const cost = (heads: string[]) => deriveInbox(input({ jobs: [failed], events, openPulls: new Map([["owner/name", heads]]) }))[0]!.cost;
  assert.deepEqual(cost([sha, "d".repeat(40)]), { level: "blocking", text: "Blocking 1 pull request" });
  assert.deepEqual(cost(["d".repeat(40)]), { level: "nothing_yet", text: "Nothing yet" });
});
