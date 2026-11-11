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
    // Windows has no mode bits: there the owner's profile is what keeps other accounts out.
    if (process.platform !== "win32") assert.equal((await stat(join(dir, "example", "state.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(dir, "example")), ["state.json"], "no temporary file is left behind");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
