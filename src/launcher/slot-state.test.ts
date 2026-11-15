import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSlotState, readSlotStates } from "./slot-state.ts";

test("the state file holds the latest report for every slot, owner-only, and reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slot-state-"));
  try {
    let time = Date.parse("2026-01-01T00:00:00Z");
    const state = createSlotState(join(dir, "example", "state.json"), "example", [{ name: "linux", label: "example-linux", slots: 2 }], () => time);
    // Reports that arrive while a write is in flight are folded into the next one.
    state.slot("linux", 1, "waiting", { detail: "VM has 900 MiB available, below its floor" });
    state.slot("linux", 1, "registered", { runner: "example-linux-1-1767225600" });
    time += 1000;
    state.slot("linux", 2, "busy", { runner: "example-linux-2-1767225600" });
    state.image("linux", "app-ci:3f9a1c2b7d4e", null);
    await state.stopping();
    // An install directory without a state file, and one with a broken file, are skipped.
    await mkdir(join(dir, "other"));
    await mkdir(join(dir, "broken"));
    await writeFile(join(dir, "broken", "state.json"), "{");

    const [read, ...rest] = await readSlotStates(dir);
    assert.equal(rest.length, 0);
    assert.equal(read?.stopping, true);
    assert.deepEqual(
      read?.kinds[0]?.slots.map(({ slot, phase, runner }) => [slot, phase, runner]),
      [
        [1, "registered", "example-linux-1-1767225600"],
        [2, "busy", "example-linux-2-1767225600"],
      ],
    );
    assert.equal(read?.kinds[0]?.image, "app-ci:3f9a1c2b7d4e");
    assert.equal((await stat(join(dir, "example", "state.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(dir, "example")), ["state.json"], "no temporary file is left behind");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a new image's facts wait for its own probe, and a late probe of an old image is ignored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slot-state-"));
  try {
    const state = createSlotState(join(dir, "example", "state.json"), "example", [{ name: "linux", label: "example-linux", slots: 1, image: { rebuildDays: 7 } }]);
    const facts = { builtAt: "2026-01-01T00:00:00.000Z", tools: [{ name: "gh", version: "2.45.0" }] };
    state.image("linux", "app-ci:aaaaaaaaaaaa", null);
    state.probed("linux", "app-ci:aaaaaaaaaaaa", facts);
    state.image("linux", "app-ci:bbbbbbbbbbbb", null);
    state.probed("linux", "app-ci:aaaaaaaaaaaa", facts);
    state.built("linux", false);
    await state.flush();

    const kind = (await readSlotStates(dir))[0]?.kinds[0];
    assert.equal(kind?.rebuildDays, 7);
    assert.equal(kind?.tools, null);
    assert.equal(kind?.builtAt, null);
    assert.equal(typeof kind?.buildFailedAt, "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a slot's job shows while its runner is busy, and goes with the runner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slot-state-"));
  try {
    const state = createSlotState(join(dir, "example", "state.json"), "example", [{ name: "linux", label: "example-linux", slots: 1 }]);
    const slot = async () => (await state.flush(), (await readSlotStates(dir))[0]?.kinds[0]?.slots[0]);
    state.slot("linux", 1, "registered", { runner: "example-linux-1-a" });
    state.job("linux", 1, "ci / test");
    assert.deepEqual(await slot().then((s) => [s?.phase, s?.job]), ["busy", "ci / test"]);
    // `up` finding the runner busy on its own keeps the job it already knows.
    state.slot("linux", 1, "busy", { runner: "example-linux-1-a" });
    assert.equal((await slot())?.job, "ci / test");
    state.slot("linux", 1, "registered", { runner: "example-linux-1-b" });
    assert.equal((await slot())?.job, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the file holds the install's memory floor, and a kind's own only where it sets one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slot-state-"));
  try {
    const kinds = [
      { name: "linux", label: "example-linux", slots: 2 },
      { name: "light", label: "example-linux-light", slots: 3, memoryFloor: { hostMiB: 500, vmMiB: 600 } },
    ];
    await createSlotState(join(dir, "example", "state.json"), "example", kinds, Date.now, { hostMiB: 1000, vmMiB: 2000 }).flush();

    const [read] = await readSlotStates(dir);
    assert.deepEqual(read?.memoryFloor, { hostMiB: 1000, vmMiB: 2000 });
    assert.deepEqual(read?.kinds.map((kind) => kind.memoryFloor), [undefined, { hostMiB: 500, vmMiB: 600 }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
