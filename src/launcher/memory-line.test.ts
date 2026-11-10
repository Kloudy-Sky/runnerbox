import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryLine } from "./memory-line.ts";

test("a slot that asks after another waits behind it, even once memory is back", async () => {
  let short: string | null = "the VM is below its floor";
  const join = createMemoryLine(async () => short);
  const waiting = join();
  assert.equal(await waiting.room(), "the VM is below its floor");

  // A job ends and frees memory. The slot it ran on asks again before the waiting slot rechecks.
  short = null;
  const finished = join();
  assert.equal(await finished.room(), "1 slot was waiting first");
  assert.equal(await waiting.room(), null);
  waiting.leave();
  assert.equal(await finished.room(), null);
});

test("a slot that stops waiting no longer holds up the ones behind it", async () => {
  const join = createMemoryLine(async () => null);
  const first = join();
  const second = join();
  assert.equal(await second.room(), "1 slot was waiting first");
  first.leave();
  assert.equal(await second.room(), null);
});
