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
  // `machineReads` counts down to a failed SSH read of the VM, as when the VM drops off mid-change.
  // `busyFails` stands for GitHub not answering whether a job is running.
  const state = { busy: false, busyFails: false, drains: [] as string[], machineReads: Infinity };
  const changes = createChanges({
    configPath,
    logPath: join(dir, "state", "changes.ndjson"),
    machine: async () => {
      if (state.machineReads-- <= 0) throw new Error("ssh: connect to host 192.168.122.10 port 22: Connection timed out");
      return MACHINE;
    },
    busy: async () => {
      if (state.busyFails) throw new Error("GitHub didn't answer");
      return state.busy;
    },
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

test("a fault while applying an idle change logs it as not applied, and doesn't stop up or drain", async () => {
  const { changes, state, config, original, log, done } = await setup();
  try {
    await changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    state.machineReads = 0;
    await changes.check();
    assert.deepEqual(await config(), JSON.parse(original));
    assert.deepEqual(state.drains, []);
    const last = (await log()).at(-1);
    assert.deepEqual([last.outcome, last.reason], ["not_applied", "Runnerbox on the machine couldn't apply it; its log there says why"]);
    assert.equal((await changes.describe().catch(() => null))?.pending ?? null, null);
  } finally {
    await done();
  }
});

test("a change applied now answers with what happened, as the log does", async () => {
  const { changes, state, config, original, log, done } = await setup();
  try {
    // The check on arrival reads the machine once; the read just before the write fails.
    state.machineReads = 1;
    await assert.rejects(changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }])), /Not applied: Runnerbox on the machine couldn't apply it/);
    assert.deepEqual(await config(), JSON.parse(original));
    assert.deepEqual(state.drains, []);
    assert.deepEqual((await log()).map((entry) => entry.outcome), ["accepted", "not_applied"]);
  } finally {
    await done();
  }
});

test("a change up would refuse to start with is refused, judged as up loads it", async () => {
  const { changes, done } = await setup({ file: "runnerbox.jobvms.example.json" });
  try {
    // 2 addresses already hold the kind's 2 slots, and job VMs need every vmMiB floor at 0.
    await assert.rejects(changes.apply(request([{ path: "runners.linux.slots", from: 2, to: 3 }])), /wouldn't load: 3 slots need 3 jobVms.addresses/);
    await assert.rejects(changes.apply(request([{ path: "memoryFloor.vmMiB", from: 0, to: 1500 }])), /wouldn't load: with `jobVms`, set every memoryFloor.vmMiB to 0/);
  } finally {
    await done();
  }
});

test("with job VMs, a kind's limits are bounded by its own VM, not the one up measured", async () => {
  const { changes, done } = await setup({ file: "runnerbox.jobvms.example.json" });
  try {
    const fields = (await changes.describe()).fields;
    assert.deepEqual(
      fields.filter((field) => field.path.startsWith("runners.linux.limits.")).map((field) => [field.path, field.max]),
      [
        ["runners.linux.limits.memory", 4608],
        ["runners.linux.limits.memoryReservation", 4608],
        ["runners.linux.limits.memorySwap", 9216],
        ["runners.linux.limits.cpus", 4],
      ],
    );
    await assert.rejects(changes.apply(request([{ path: "runners.linux.limits.cpus", from: 4, to: 6 }])), /between 0.25 and 4/);
  } finally {
    await done();
  }
});

test("memory limits that Docker would refuse together are refused, though each is in bounds", async () => {
  const { changes, done } = await setup();
  try {
    await assert.rejects(changes.apply(request([{ path: "runners.linux.limits.memory", from: "3600m", to: "6g" }])), /memoryReservation ≤ memory ≤ memorySwap/);
    await assert.rejects(changes.apply(request([{ path: "runners.linux.limits.memoryReservation", from: "1500m", to: "4g" }])), /memoryReservation ≤ memory ≤ memorySwap/);
    await changes.apply(request([{ path: "runners.linux.limits.memory", from: "3600m", to: "6g" }, { path: "runners.linux.limits.memorySwap", from: "5g", to: "8g" }]));
  } finally {
    await done();
  }
});

test("two approvals arriving together: one waits, the other is refused and the first isn't lost", async () => {
  const { changes, state, config, log, done } = await setup();
  try {
    state.busy = true;
    const results = await Promise.allSettled([
      changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle", "0000000000000001")),
      changes.apply(request([{ path: "memoryFloor.vmMiB", from: 1500, to: 2000 }], "idle", "0000000000000002")),
    ]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
    assert.equal((await changes.describe()).pending?.proposalId, "0000000000000001");
    assert.deepEqual((await log()).map((entry) => entry.proposalId), ["0000000000000001"]);
    state.busy = false;
    await changes.check();
    assert.equal((await config()).runners[0].slots, 2);
  } finally {
    await done();
  }
});

const restartRequest = { op: "restart" as const, requestedBy: { session: "session-1", label: "desktop" } };
const restarts = async (log: () => Promise<Array<Record<string, unknown>>>) => (await log()).filter((entry) => entry.kind === "restart");

test("a restart the owner asks for waits until no job is running, then restarts, and names who asked", async () => {
  const { changes, state, clock, log, done } = await setup();
  try {
    state.busy = true;
    assert.deepEqual(await changes.restart(restartRequest), { restart: { since: "2026-11-12T10:00:00.000Z", requestedBy: "desktop" } });
    await changes.check();
    clock.now += 60_000;
    await changes.check();
    assert.deepEqual(state.drains, [], "not while a job runs");
    assert.deepEqual(changes.restartWaiting(), { restart: { since: "2026-11-12T10:00:00.000Z", requestedBy: "desktop" } });
    state.busy = false;
    await changes.check();
    assert.equal(state.drains.length, 1);
    assert.deepEqual(changes.restartWaiting(), { restart: null });
    assert.deepEqual(
      (await restarts(log)).map(({ outcome, requestedBy }) => ({ outcome, requestedBy })),
      [
        { outcome: "waiting", requestedBy: { session: "session-1", label: "desktop" } },
        { outcome: "restarted", requestedBy: { session: "session-1", label: "desktop" } },
      ],
    );
  } finally {
    await done();
  }
});

test("a restart counts a failed busy check as busy, and is dropped after 6 hours, said in the log", async () => {
  const { changes, state, clock, log, done } = await setup();
  try {
    await changes.restart(restartRequest);
    state.busyFails = true;
    await changes.check();
    assert.deepEqual(state.drains, [], "GitHub not answering isn't a moment without a job");
    clock.now += IDLE_LIMIT_MS + 60_000;
    state.busyFails = false;
    await changes.check();
    assert.deepEqual(state.drains, [], "nothing is forced after 6 hours");
    assert.deepEqual(changes.restartWaiting(), { restart: null });
    const last = (await restarts(log)).at(-1);
    assert.equal(last?.outcome, "not_restarted");
    assert.equal(last?.reason, "no moment without a running job came in 6 hours");
  } finally {
    await done();
  }
});

test("a second restart, or one while a change waits, is refused; one on an install without changes or on a host install is too", async () => {
  const { changes, state, done } = await setup();
  try {
    state.busy = true;
    await changes.restart(restartRequest);
    await assert.rejects(changes.restart(restartRequest), (error) => error instanceof ChangeRefused && error.message === "A restart is already waiting.");
  } finally {
    await done();
  }
  const withChange = await setup();
  try {
    withChange.state.busy = true;
    await withChange.changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    await assert.rejects(withChange.changes.restart(restartRequest), /A change is waiting to apply, and it restarts the runners when it does\./);
  } finally {
    await withChange.done();
  }
  const off = await setup({ changes: false });
  try {
    await assert.rejects(off.changes.restart(restartRequest), /To restart these from here, turn on changes in this machine's Runnerbox config\./);
  } finally {
    await off.done();
  }
  const host = await setup({ file: "runnerbox.host.example.json", changes: false });
  try {
    await assert.rejects(host.changes.restart(restartRequest), /runs jobs on the machine's own OS/);
  } finally {
    await host.done();
  }
});

test("a change approved while a restart waits goes first: applied, it settles the restart; not applied, the restart still runs", async () => {
  const applied = await setup();
  try {
    applied.state.busy = true;
    await applied.changes.restart(restartRequest);
    await applied.changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    applied.state.busy = false;
    await applied.changes.check();
    assert.equal(applied.state.drains.length, 1, "one restart, for both");
    assert.deepEqual(applied.changes.restartWaiting(), { restart: null });
    assert.equal((await restarts(applied.log)).at(-1)?.outcome, "restarted");
  } finally {
    await applied.done();
  }
  const refused = await setup();
  try {
    refused.state.busy = true;
    await refused.changes.restart(restartRequest);
    await refused.changes.apply(request([{ path: "runners.linux.slots", from: 1, to: 2 }], "idle"));
    // Someone edits the config by hand, so the change no longer applies.
    const edited = JSON.parse(await readFile(refused.configPath, "utf8"));
    edited.runners[0].slots = 2;
    await writeFile(refused.configPath, JSON.stringify(edited));
    refused.state.busy = false;
    await refused.changes.check();
    assert.deepEqual(refused.state.drains, [], "the change wasn't written");
    assert.notEqual(refused.changes.restartWaiting().restart, null, "the owner's restart still waits");
    await refused.changes.check();
    assert.equal(refused.state.drains.length, 1);
    assert.equal((await restarts(refused.log)).at(-1)?.outcome, "restarted");
  } finally {
    await refused.done();
  }
});
