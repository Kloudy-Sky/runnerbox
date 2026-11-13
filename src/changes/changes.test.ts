import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ApplyRequest } from "../control/protocol.ts";
import { ChangeRefused, createChanges, IDLE_LIMIT_MS, KEEP_BACKUPS } from "./changes.ts";

const MACHINE = { hostMiB: 32_768, vmMiB: 16_384, vmCpus: 8 };
const HASH = "a".repeat(64);

// A temporary copy of an example config, with `changes` turned on unless a test says otherwise.
async function setup(options: { file?: string; changes?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "rbx-changes-"));
  const example = JSON.parse(await readFile(options.file ?? "runnerbox.example.json", "utf8"));
  const configPath = join(dir, "example.json");
  const original = `${JSON.stringify(options.changes === false ? example : { ...example, changes: true }, null, 2)}\n`;
  await writeFile(configPath, original, { mode: 0o600 });
  const clock = { now: Date.parse("2026-11-12T10:00:00Z") };
  const state = { busy: false, drains: [] as string[] };
  const changes = createChanges({
    configPath,
    logPath: join(dir, "state", "changes.ndjson"),
    machine: async () => MACHINE,
    busy: async () => state.busy,
    drain: (why) => void state.drains.push(why),
    every: () => () => {},
    now: () => clock.now,
    log: () => {},
  });
  const config = async () => JSON.parse(await readFile(configPath, "utf8"));
  const log = async () => (await readFile(join(dir, "state", "changes.ndjson"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { dir, configPath, original, changes, clock, state, config, log, done: () => rm(dir, { recursive: true, force: true }) };
}

const request = (changes: ApplyRequest["changes"], when: "idle" | "now" = "now", id = "0123456789abcdef"): ApplyRequest => ({
  op: "apply",
  proposalId: id,
  hash: HASH,
  approvedBy: { session: "session-1", label: "desktop" },
  when,
  changes,
});

test("a field off the allow-list is refused, whatever the agent asks for", async () => {
  const { changes, configPath, original, state, done } = await setup();
  try {
    for (const path of ["tokenFile", "scope.repo", "allowPublicRepos", "changes", "vm.host", "runners.linux.image", "runners.linux.env.EXAMPLE_MAX_WORKERS", "runners.linux.limits.pids", "runners.linux.label", "runners.other.slots", "runners.linux.memoryFloor.hostMiB"]) {
      await assert.rejects(changes.apply(request([{ path, from: 1, to: 2 }])), (error: Error) => error instanceof ChangeRefused && /isn't a field a proposal can change/.test(error.message), path);
    }
    assert.equal(await readFile(configPath, "utf8"), original);
    assert.deepEqual(state.drains, []);
  } finally {
    await done();
  }
});

test("a value out of bounds for this machine is refused", async () => {
  const { changes, done } = await setup();
  try {
    const cases: Array<[ApplyRequest["changes"][number], RegExp]> = [
      [{ path: "runners.linux.slots", from: 1, to: 3 }, /between 1 and 2/],
      [{ path: "runners.linux.slots", from: 1, to: 0 }, /between 1 and 2/],
      [{ path: "runners.linux.slots", from: 1, to: 1.5 }, /whole number/],
      [{ path: "memoryFloor.vmMiB", from: 1500, to: 99_999 }, /between 0 and 16384/],
      [{ path: "runners.linux.limits.memory", from: "3600m", to: "64g" }, /between 64m and 16384m/],
      [{ path: "runners.linux.limits.memory", from: "3600m", to: 4096 }, /size such as 3600m/],
      [{ path: "runners.linux.limits.cpus", from: 4, to: 16 }, /between 0.25 and 8/],
    ];
    for (const [change, refusal] of cases) await assert.rejects(changes.apply(request([change])), refusal);
  } finally {
    await done();
  }
});

test("a change based on values the config no longer has is refused", async () => {
  const { changes, done } = await setup();
  try {
    await assert.rejects(changes.apply(request([{ path: "runners.linux.slots", from: 2, to: 1 }])), /changed since this was proposed: runners\.linux\.slots is 1 now, not 2/);
  } finally {
    await done();
  }
});

test("an install that isn't a VM install, or hasn't turned changes on, takes none", async () => {
  // A host install can't even have `changes`: its schema refuses the key. Without it, it's still refused.
  const host = await setup({ file: "runnerbox.host.example.json", changes: false });
  const off = await setup({ changes: false });
  try {
    await assert.rejects(host.changes.apply(request([{ path: "runners.macos.slots", from: 1, to: 1 }])), /VM installs only/);
    await assert.rejects(off.changes.describe(), /no "changes": true/);
  } finally {
    await host.done();
    await off.done();
  }
});

test("applied now: only the approved fields change, the old file is kept, the change is logged and up drains", async () => {
  const { changes, configPath, original, dir, state, config, log, done } = await setup();
  try {
    await changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }, { path: "memoryFloor.vmMiB", from: 1500, to: 2500 }]));
    const expected = JSON.parse(original);
    expected.runners[0].slots = 2;
    expected.memoryFloor.vmMiB = 2500;
    assert.deepEqual(await config(), expected);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    const [backup] = (await readdir(dir)).filter((name) => name.endsWith(".bak"));
    assert.equal(await readFile(join(dir, backup!), "utf8"), original);
    assert.equal((await stat(join(dir, backup!))).mode & 0o777, 0o600);
    const entries = await log();
    assert.deepEqual(entries.map((entry) => entry.outcome), ["accepted", "applied"]);
    assert.deepEqual(entries[1].approvedBy, { session: "session-1", label: "desktop" });
    assert.equal(entries[1].hash, HASH);
    assert.deepEqual(state.drains, ["applying change 0123456789abcdef"]);
  } finally {
    await done();
  }
});

test("applied when idle: it waits while a job runs, and a hand edit in the meantime stops it", async () => {
  const waits = await setup();
  const edited = await setup();
  try {
    waits.state.busy = true;
    await waits.changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    await waits.changes.check();
    assert.equal((await waits.config()).runners[0].slots, 1);
    assert.equal((await waits.changes.describe()).pending?.when, "idle");
    await assert.rejects(waits.changes.apply(request([{ path: "memoryFloor.vmMiB", from: 1500, to: 2000 }])), /already waiting/);
    waits.state.busy = false;
    await waits.changes.check();
    assert.equal((await waits.config()).runners[0].slots, 2);
    assert.equal(waits.state.drains.length, 1);

    await edited.changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    await writeFile(edited.configPath, edited.original.replace('"slots": 1', '"slots": 2'));
    await edited.changes.check();
    assert.equal((await edited.log()).at(-1).outcome, "not_applied");
    assert.match((await edited.log()).at(-1).reason, /changed since this was proposed/);
    assert.deepEqual(edited.state.drains, []);
  } finally {
    await waits.done();
    await edited.done();
  }
});

test("a change that finds no idle moment in 6 hours is dropped and logged, never forced", async () => {
  const { changes, clock, state, config, original, log, done } = await setup();
  try {
    state.busy = true;
    await changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    clock.now += IDLE_LIMIT_MS + 1;
    await changes.check();
    assert.deepEqual(await config(), JSON.parse(original));
    assert.deepEqual(state.drains, []);
    assert.deepEqual([(await log()).at(-1).outcome, (await log()).at(-1).reason], ["not_applied", "no moment without a running job came in 6 hours"]);
    assert.equal((await changes.describe()).pending, null);
  } finally {
    await done();
  }
});

test("a revert puts the previous values back, and only five old files are kept", async () => {
  const { changes, clock, dir, config, original, done } = await setup();
  try {
    const forward = [{ path: "runners.linux.slots", from: 1, to: 2 }] as const;
    const back = [{ path: "runners.linux.slots", from: 2, to: 1 }] as const;
    for (let round = 0; round < 4; round++) {
      clock.now += 60_000;
      await changes.apply(request([...forward]));
      clock.now += 60_000;
      await changes.apply(request([...back]));
    }
    assert.deepEqual(await config(), JSON.parse(original));
    assert.equal((await readdir(dir)).filter((name) => name.endsWith(".bak")).length, KEEP_BACKUPS);
  } finally {
    await done();
  }
});
