import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryLine } from "./memory-line.ts";

const heavy = { hostMiB: 500, vmMiB: 1500 };
const light = { hostMiB: 200, vmMiB: 400 };

test("a slot that asks after another waits behind it, even once memory is back", async () => {
  let short: string | null = "the VM is below its floor";
  const join = createMemoryLine(async () => short);
  const waiting = join(heavy);
  assert.equal(await waiting.room(), "the VM is below its floor");

  // A job ends and frees memory. The slot it ran on asks again before the waiting slot rechecks.
  short = null;
  const finished = join(heavy);
  assert.equal(await finished.room(), "1 slot was waiting first");
  assert.equal(await waiting.room(), null);
  waiting.leave();
  assert.equal(await finished.room(), null);
});

test("a slot that stops waiting no longer holds up the ones behind it", async () => {
  const join = createMemoryLine(async () => null);
  const first = join(heavy);
  const second = join(heavy);
  assert.equal(await second.room(), "1 slot was waiting first");
  first.leave();
  assert.equal(await second.room(), null);
});

test("a light slot that fits starts past a heavy one still waiting, but not the other way", async () => {
  const vmAvailable = 1000;
  const join = createMemoryLine(async (floor) => (vmAvailable < floor.vmMiB ? "the VM is below its floor" : null));
  const heavySlot = join(heavy);
  const lightSlot = join(light);
  assert.equal(await heavySlot.room(), "the VM is below its floor");
  assert.equal(await lightSlot.room(), null);

  const laterHeavy = join(heavy);
  assert.equal(await laterHeavy.room(), "2 slots were waiting first");
});
