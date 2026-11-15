import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSlotState } from "runnerbox/src/launcher/slot-state.ts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import type { LauncherEvent } from "runnerbox/src/tracking/launcher-event.ts";
import type { Sample } from "runnerbox/src/tracking/sample-record.ts";

// Writes a state directory that looks like two weeks of `report` and `up` on one host: two repos,
// one install with two runner kinds, and each thing the inbox looks for. Names are generic and the
// numbers come from a seeded generator, so every run writes the same files.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const INSTALL = "example";
export const LINUX_IMAGE = "app-ci:3f9a1c2b7d4e";
const SELF_HOSTED = ["self-hosted", "example-linux"];
const HOSTED = ["ubuntu-24.04"];

// A made-up commit SHA, the same for every run of one push.
const shaFor = (push: number) => [...Array(5)].map((_, index) => ((push * 2_654_435_761 + index * 40_503) >>> 0).toString(16).padStart(8, "0")).join("");

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

type Plan = { workflow: string; job: string; labels: string[]; ms: number; steps: [string, number][] };

const CI: Plan[] = [
  { workflow: "ci", job: "build", labels: SELF_HOSTED, ms: 70_000, steps: [["Set up job", 0.05], ["Checkout", 0.1], ["pnpm install", 0.4], ["Build", 0.45]] },
  { workflow: "ci", job: "test", labels: SELF_HOSTED, ms: 400_000, steps: [["Set up job", 0.01], ["Checkout", 0.02], ["pnpm install", 0.12], ["Typecheck", 0.08], ["Test", 0.77]] },
  { workflow: "ci", job: "lint", labels: HOSTED, ms: 38_000, steps: [["Set up job", 0.1], ["Checkout", 0.15], ["Lint", 0.75]] },
];

// Steps before the failed one passed, and the ones after it were skipped. Each starts where the
// one before it ended.
function stepsFor(plan: Plan, ms: number, failStep: string | undefined, started: number) {
  const failedAt = plan.steps.findIndex(([name]) => name === failStep);
  let at = started;
  return plan.steps.map(([name, share], index) => {
    const skipped = failedAt >= 0 && index > failedAt;
    const length = Math.round(ms * share);
    const step = {
      name,
      conclusion: failedAt < 0 || index < failedAt ? "success" : index === failedAt ? "failure" : "skipped",
      ms: skipped ? null : length,
      ...(skipped ? {} : { startedAt: new Date(at).toISOString() }),
    };
    if (!skipped) at += length;
    return step;
  });
}

// The linux kind's container limits, as its runner events record them.
const LINUX_LIMITS = { memoryMiB: 3686, cpus: 4 };
const READING_MS = 15_000;
// How a job's container used memory and CPU: most jobs grow a little through their longest step;
// one climbs to its memory limit and is stopped; slow builds sit at the CPU limit while building.
type Profile = "normal" | "climb" | "cpu";
type Run = { slot: number; start: number; end: number; profile: Profile; steps: { name: string; startedAt?: string; ms: number | null }[] };

function readingFor(run: Run, at: number, jitter: (ms: number, spread?: number) => number) {
  const share = (at - run.start) / (run.end - run.start);
  const step = run.steps.find((each) => each.startedAt && each.ms !== null && at >= Date.parse(each.startedAt) && at <= Date.parse(each.startedAt) + each.ms)?.name;
  if (run.profile === "climb") return { cpuPercent: jitter(260, 0.2), memMiB: Math.round(700 + share * (LINUX_LIMITS.memoryMiB - 700)) };
  if (run.profile === "cpu" && step === "Build") return { cpuPercent: jitter(392, 0.02), memMiB: jitter(1400, 0.05) };
  const working = step === "Test" || step === "Build" || step === "pnpm install";
  return { cpuPercent: working ? jitter(180, 0.3) : jitter(30, 0.5), memMiB: Math.round(500 + share * 900 + (working ? 300 : 0)) };
}

export async function writeFixtures(dir: string, now: number) {
  const next = random(7);
  const jitter = (ms: number, spread = 0.15) => Math.round(ms * (1 - spread + next() * spread * 2));
  const iso = (ms: number) => new Date(ms).toISOString();
  const jobs: Record<string, JobRecord[]> = { "owner/name": [], "owner/other": [] };
  const events: (LauncherEvent & { time: string })[] = [];
  let jobId = 1000;
  // Times when the VM ran short of memory, which the samples below dip at.
  const pressure: [number, number][] = [];
  // Each job that ran in one of the install's containers, for its readings.
  const runs: Run[] = [];

  const runner = (labels: string[], slot: number, at: number) =>
    labels === HOSTED ? `GitHub Actions ${Math.floor(next() * 90) + 10}` : `${INSTALL}-linux-${slot}-${Math.floor(at / 1000)}`;

  const add = (repo: string, plan: Plan, run: { runId: number; at: number; branch: string; attempt?: number; headSha?: string }, outcome: {
    conclusion?: string;
    ms?: number;
    runner?: string | null;
    slot?: number;
    exitCode?: number | null;
    failStep?: string;
    profile?: Profile;
  } = {}) => {
    const attempt = run.attempt ?? 1;
    const ms = outcome.ms ?? jitter(plan.ms);
    const queued = run.at;
    const started = queued + jitter(8_000, 0.6);
    const slot = outcome.slot ?? (Math.floor(next() * 2) + 1);
    const name = outcome.runner === undefined ? runner(plan.labels, slot, started) : outcome.runner;
    const conclusion = outcome.conclusion ?? "success";
    const record: JobRecord = {
      v: 1,
      repo,
      workflow: plan.workflow,
      job: plan.job,
      jobId: jobId++,
      runId: run.runId,
      attempt,
      branch: run.branch,
      ...(run.headSha ? { headSha: run.headSha } : {}),
      conclusion,
      runner: name,
      labels: plan.labels,
      createdAt: iso(queued),
      startedAt: name === null && conclusion === "cancelled" ? iso(queued + ms) : iso(started),
      completedAt: iso(started + ms),
      steps: name === null ? [] : stepsFor(plan, ms, outcome.failStep, started),
    };
    jobs[repo]!.push(record);
    if (name?.startsWith(`${INSTALL}-`)) {
      // The runner waited for its job a little before it started.
      const registered = started - jitter(20_000, 0.8);
      events.push({
        time: iso(started + ms),
        event: "runner",
        runnerType: "linux",
        slot,
        runner: name,
        startedAt: iso(registered),
        durationMs: started + ms - registered,
        exitCode: outcome.exitCode === undefined ? 0 : outcome.exitCode,
        released: false,
        image: LINUX_IMAGE,
        limits: LINUX_LIMITS,
      });
      runs.push({ slot, start: started, end: started + ms, profile: outcome.profile ?? "normal", steps: record.steps });
    }
    return record;
  };

  let runId = 5000;
  const branches = ["main", "main", "fix/cache", "feat/gate"];
  // A run every 2 to 3 hours for two weeks, oldest first.
  for (let at = now - 14 * 24 * HOUR; at < now - HOUR; at += jitter(150 * MINUTE, 0.3)) {
    const branch = branches[Math.floor(next() * branches.length)]!;
    const run = { runId: runId++, at, branch, headSha: shaFor(runId) };
    const recent = now - at < 10 * HOUR;
    for (const plan of CI) {
      if (plan.job === "test" && branch === "feat/gate" && now - at < 3 * 24 * HOUR) {
        // Code: fails on both attempts.
        add("owner/name", plan, run, { conclusion: "failure", failStep: "Test", ms: jitter(250_000) });
        add("owner/name", plan, { ...run, attempt: 2 }, { conclusion: "failure", failStep: "Test", ms: jitter(250_000) });
        // The same commit, re-run on hosted runners from another workflow run, fails there too.
        add("owner/name", { ...plan, labels: HOSTED, ms: plan.ms * 1.3 }, { ...run, runId: runId++, at: at + 30 * MINUTE }, { conclusion: "failure", failStep: "Test", ms: jitter(320_000) });
      } else if (plan.job === "test" && next() < 0.07) {
        // Flaky: passes on the second attempt.
        add("owner/name", plan, run, { conclusion: "failure", failStep: "Test" });
        add("owner/name", plan, { ...run, at: at + 10 * MINUTE, attempt: 2 });
      } else if (plan.job === "build" && recent) {
        // Slow: the last few builds take three times as long.
        add("owner/name", plan, run, { ms: jitter(plan.ms * 3), profile: "cpu" });
      } else if (plan.job === "test" && next() < 0.25) {
        // The repo's runner variable sometimes points back at hosted runners, which are slower here.
        add("owner/name", { ...plan, labels: HOSTED, ms: plan.ms * 1.3 }, run);
      } else {
        add("owner/name", plan, run);
      }
    }
    if (next() < 0.5) add("owner/other", CI[1]!, { ...run, runId: runId++ });
  }

  // Infra: the test job's container was killed for memory 40 minutes ago, and the retry passed.
  const killedAt = now - 40 * MINUTE;
  pressure.push([killedAt, killedAt + 5 * MINUTE]);
  const killed = { runId: runId++, at: killedAt, branch: "fix/cache", headSha: shaFor(runId) };
  add("owner/name", CI[1]!, killed, { conclusion: "failure", failStep: "Test", slot: 2, exitCode: 137, ms: 4 * MINUTE, profile: "climb" });
  add("owner/name", CI[1]!, { ...killed, at: killedAt + 12 * MINUTE, attempt: 2 }, { slot: 1 });

  // No runner: two jobs waited and were cancelled while slots waited for memory.
  for (const offset of [3 * HOUR, 2.5 * HOUR]) {
    const at = now - offset;
    add("owner/name", CI[1]!, { runId: runId++, at, branch: "main" }, { conclusion: "cancelled", runner: null, ms: 25 * MINUTE });
    events.push({ time: iso(at + 30 * MINUTE), event: "memory_wait", runnerType: "linux", slot: 1, startedAt: iso(at - 5 * MINUTE), durationMs: 30 * MINUTE });
    pressure.push([at - 5 * MINUTE, at + 25 * MINUTE]);
  }

  // A failing slot: the docker kind's only slot keeps exiting 125 on start.
  for (let index = 0; index < 4; index++) {
    const at = now - (90 - index * 20) * MINUTE;
    events.push({ time: iso(at + 3000), event: "runner", runnerType: "docker", slot: 1, runner: `${INSTALL}-docker-1-${Math.floor(at / 1000)}`, startedAt: iso(at), durationMs: 3000, exitCode: 125, released: false });
  }
  // Image builds, one failed, and runners released for memory and for a new image.
  events.push({ time: iso(now - 6 * HOUR), event: "image_build", runnerType: "linux", tag: LINUX_IMAGE, startedAt: iso(now - 6 * HOUR - 4 * MINUTE), durationMs: 4 * MINUTE, ok: true });
  events.push({ time: iso(now - 2 * HOUR), event: "image_build", runnerType: "docker", tag: "app-docker:9c1e2f3a4b5d", startedAt: iso(now - 2 * HOUR - MINUTE), durationMs: MINUTE, ok: false });
  events.push({ time: iso(now - 5 * HOUR), event: "runner", runnerType: "linux", slot: 2, runner: `${INSTALL}-linux-2-${Math.floor((now - 6 * HOUR) / 1000)}`, startedAt: iso(now - 6 * HOUR), durationMs: HOUR, exitCode: 0, released: "image" });

  // Each slot's container at `at`: its job's reading while one runs, or else an idle runner.
  const containersAt = (at: number) =>
    [1, 2].map((slot) => {
      const run = runs.find((each) => each.slot === slot && at >= each.start && at <= each.end);
      return { name: `${INSTALL}-linux-slot${slot}`, ...(run ? readingFor(run, at, jitter) : { cpuPercent: 0.4, memMiB: 160 }) };
    });
  // Readings every 15 seconds while each of the last three days' jobs ran, as `up` takes them.
  const times = runs
    .filter((run) => run.start >= now - 3 * 24 * HOUR)
    .flatMap((run) => Array.from({ length: Math.floor((run.end - run.start) / READING_MS) + 1 }, (_, index) => run.start + index * READING_MS));
  const readings = [...new Set(times)]
    .toSorted((a, b) => a - b)
    .map((at) => ({ time: iso(at), containers: containersAt(at) }));

  // A sample a minute for the last three days.
  const samples: Sample[] = [];
  let swap = 120;
  for (let at = now - 3 * 24 * HOUR; at <= now; at += MINUTE) {
    const squeezed = pressure.some(([start, end]) => at >= start && at <= end);
    swap = squeezed ? Math.min(swap + 40, 1600) : Math.max(swap - 5, 120);
    const busy = Math.sin(at / (37 * MINUTE)) * 0.5 + 0.5;
    const vmAvailable = squeezed ? jitter(700, 0.3) : Math.round(5200 + busy * 6000 * (0.8 + next() * 0.4));
    samples.push({
      time: iso(at),
      host: { totalMiB: 65_536, availableMiB: Math.round(30_000 + busy * 12_000), swapUsedMiB: 0, load1: Math.round((1 + busy * 6) * 100) / 100, cpuBusyPercent: Math.round(10 + busy * 55) },
      vm: { totalMiB: 16_384, availableMiB: vmAvailable, swapUsedMiB: swap, load1: Math.round((0.5 + busy * 5) * 100) / 100, cpuBusyPercent: Math.round(5 + busy * 80) },
      containers: containersAt(at),
    });
  }

  await mkdir(join(dir, INSTALL), { recursive: true, mode: 0o700 });
  const ndjson = (lines: readonly object[]) => lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  for (const [repo, records] of Object.entries(jobs)) {
    await writeFile(join(dir, `${repo.replace("/", "__")}.ndjson`), ndjson(records), { mode: 0o600 });
  }
  await writeFile(join(dir, INSTALL, "events.ndjson"), ndjson(events.toSorted((a, b) => a.time.localeCompare(b.time))), { mode: 0o600 });
  await writeFile(join(dir, INSTALL, "samples.ndjson"), ndjson(samples), { mode: 0o600 });
  await writeFile(join(dir, INSTALL, "containers.ndjson"), ndjson(readings), { mode: 0o600 });
  // What `up` reports right now, written by the core's own writer: one linux slot on a job, one
  // waiting in line for memory, and the docker slot backing off after its failures.
  const live = createSlotState(join(dir, INSTALL, "state.json"), INSTALL, [
    { name: "linux", label: "example-linux", slots: 2, image: { rebuildDays: 7 }, runsIn: "container" },
    { name: "docker", label: "example-docker", slots: 1, runsIn: "container" },
  ], () => now);
  live.image("linux", LINUX_IMAGE, null);
  // An image three days old with an old gh, so the image facts have something to flag.
  live.probed("linux", LINUX_IMAGE, {
    builtAt: new Date(now - 72 * HOUR).toISOString(),
    tools: [
      { name: "Ubuntu", version: "24.04" },
      { name: "node", version: "24.11.1" },
      { name: "gh", version: "2.45.0" },
      { name: "git", version: "2.43.0" },
      { name: "docker", version: null },
      { name: "python", version: "3.12.3" },
      { name: "aws", version: null },
      { name: "runner", version: "2.338.2" },
    ],
  });
  live.image("docker", null, "app-docker:9c1e2f3a4b5d");
  live.slot("linux", 1, "busy", { runner: `${INSTALL}-linux-1-${Math.floor(now / 1000) - 300}` });
  live.job("linux", 1, "ci / test");
  live.slot("linux", 2, "waiting", { detail: "VM has 1840 MiB available, below its floor of 2048 MiB" });
  live.slot("docker", 1, "backoff", { detail: "the last runner exited 125 within a minute" });
  await live.flush();
  return { jobs, events, samples };
}
