import assert from "node:assert/strict";
import { test } from "node:test";
import { runSlots } from "./run-slots.ts";

// runSlots never returns on its own, so a wait after the given count ends the test.
class Stop extends Error {}

function fakes({ mintFails = false, waitsBeforeStop = 1, exitCode = 0, jobMs = 0 } = {}) {
  const events: string[] = [];
  let waits = 0;
  let time = 1_700_000_000_000;
  return {
    events,
    actions: {
      mint: async (name: string) => {
        events.push(`mint ${name}`);
        if (mintFails) throw new Error("GitHub returned 401");
        return `registration-for-${name}`;
      },
      runContainer: async (slot: number, registration: string) => {
        events.push(`run ${slot} ${registration}`);
        time += jobMs;
        return exitCode;
      },
      wait: async (ms: number) => {
        events.push(`wait ${ms}`);
        if (++waits >= waitsBeforeStop) throw new Stop();
      },
      now: () => time,
      log: (message: string) => void events.push(`log ${message}`),
    },
  };
}

test("each runner gets its own registration, and the next starts after a short wait", async () => {
  const { actions, events } = fakes();
  await assert.rejects(runSlots("box", 1, actions), Stop);

  assert.deepEqual(events, [
    "mint box-1-1700000000",
    "run 1 registration-for-box-1-1700000000",
    "log slot 1: box-1-1700000000 finished (0)",
    "wait 5000",
  ]);
});

test("a failed mint starts no container, waits a minute, and doesn't end the slot", async () => {
  const { actions, events } = fakes({ mintFails: true, waitsBeforeStop: 2 });
  await assert.rejects(runSlots("box", 1, actions), Stop);

  assert.deepEqual(events.filter((event) => event.startsWith("run")), []);
  assert.deepEqual(events.filter((event) => event.startsWith("wait")), ["wait 60000", "wait 60000"]);
  assert.ok(events.includes("log slot 1: could not mint a registration: GitHub returned 401"));
});

test("a fast failure backs off like a failed mint, but a slow one doesn't", async () => {
  const fast = fakes({ exitCode: 255, jobMs: 1_000 });
  await assert.rejects(runSlots("box", 1, fast.actions), Stop);
  assert.equal(fast.events.at(-1), "wait 60000");

  const slow = fakes({ exitCode: 1, jobMs: 600_000 });
  await assert.rejects(runSlots("box", 1, slow.actions), Stop);
  assert.equal(slow.events.at(-1), "wait 5000");
});

test("slots run separately under their own names", async () => {
  const { actions, events } = fakes({ waitsBeforeStop: 2 });
  await assert.rejects(runSlots("box", 2, actions), Stop);

  assert.ok(events.includes("mint box-1-1700000000"));
  assert.ok(events.includes("mint box-2-1700000000"));
});
