import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { LauncherEvent } from "./launcher-event.ts";
import { summarizeLauncher } from "./launcher-summary.ts";
import { summarizeMachines } from "./machine-summary.ts";
import { createRedactor, loadRedactionKey } from "./redactor.ts";
import type { JobSummary } from "./report.ts";
import { formatWeeklySummary, redactSummary } from "./weekly-summary.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-summary-"));
after(() => rm(dir, { recursive: true }));

const startedAt = "2026-01-01T00:00:00Z";
const runner = (exitCode: number | null, released: false | "memory" | "image"): LauncherEvent => ({
  event: "runner", slot: 1, runner: "rb-linux-1-1", startedAt, durationMs: 60_000, exitCode, released, runnerType: "linux",
});

test("the launcher row counts failures apart from runners removed on purpose", () => {
  const events: LauncherEvent[] = [
    runner(0, false),
    runner(1, false),
    runner(null, false),
    runner(1, "memory"),
    runner(1, "image"),
    { event: "memory_wait", slot: 1, startedAt, durationMs: 30_000, runnerType: "linux" },
    { event: "image_build", tag: "app:1", ok: false, startedAt, durationMs: 5_000, runnerType: "linux" },
    { event: "image_build", tag: "app:2", ok: true, startedAt, durationMs: 90_000, runnerType: "linux" },
  ];
  const [row] = summarizeLauncher(events.map((record) => ({ install: "rb", record })));
  assert.deepEqual(row, {
    install: "rb", runnerType: "linux", runners: 5, failedRunners: 2, releasedForMemory: 1, releasedForImage: 1,
    memoryWaits: 1, memoryWaitP90Ms: 30_000, imageBuilds: 2, failedBuilds: 1, buildP50Ms: 90_000,
  });
});

test("the machine row shows how low memory got, from VM samples only where the VM was read", () => {
  const vm = (availableMiB: number) => ({ totalMiB: 4096, availableMiB, swapUsedMiB: 100, load1: 1 });
  const [row] = summarizeMachines(
    [{ time: startedAt, vm: vm(900) }, { time: startedAt, vm: vm(300) }, { time: startedAt }].map((sample) => ({ install: "rb", sample })),
  );
  assert.equal(row?.samples, 3);
  assert.equal(row?.vmAvailableMinMiB, 300);
  assert.equal(row?.hostAvailableP10MiB, null);
});

test("a redacted summary names no repo, job, runner, install or kind, and hashes them the same each time", async () => {
  const key = await loadRedactionKey(dir);
  assert.equal(await loadRedactionKey(dir), key);
  if (process.platform !== "win32") assert.equal((await stat(join(dir, "summary.key"))).mode & 0o777, 0o600);

  const job: JobSummary = {
    workflow: "ci", job: "secret-job | x", runnerType: "rb-linux", ran: 1, failed: 0, passedOnRetry: 0, noRunner: 0,
    p50Ms: 1000, p90Ms: 1000, queueP50Ms: 0, queueP90Ms: 0, totalMs: 1000, vmLowP50MiB: null, hostLowP50MiB: null, vmSwapP90MiB: null,
  };
  const redact = createRedactor(key);
  const summary = {
    repo: "acme/private-app", since: new Date(startedAt), until: new Date(startedAt), jobs: [job],
    launcher: summarizeLauncher([{ install: "rb", record: runner(0, false) }]), machines: [],
  };
  const markdown = formatWeeklySummary(redactSummary(summary, redact));

  for (const name of ["acme", "private-app", "secret-job", "rb-linux", "| rb |", "linux"]) assert.ok(!markdown.includes(name), name);
  assert.ok(markdown.includes(redact("job", "secret-job | x")));
  assert.equal(redact("job", "ci"), createRedactor(key)("job", "ci"));
  assert.notEqual(redact("job", "ci"), createRedactor("another key")("job", "ci"));
  assert.match(markdown, /## Machines\n\nNone recorded\./);
});

test("a pipe in a name can't break the table", () => {
  const markdown = formatWeeklySummary({
    repo: "a/b", since: new Date(startedAt), until: new Date(startedAt), jobs: [], machines: [],
    launcher: summarizeLauncher([{ install: "a|b", record: runner(0, false) }]),
  });
  assert.ok(markdown.includes("| a\\|b |"));
});

test("a key file that isn't a key stops redaction instead of hashing with it", async () => {
  const broken = join(dir, "broken");
  await mkdir(broken);
  await writeFile(join(broken, "summary.key"), "");
  await assert.rejects(loadRedactionKey(broken), /isn't a redaction key/);
});

test("the same name in two columns gets two hashes, so the rows can't be linked", () => {
  const redact = createRedactor("key");
  assert.notEqual(redact("install", "ci"), redact("runner", "ci"));
  assert.equal(redact("install", "ci"), redact("install", "ci"));
});
