import assert from "node:assert/strict";
import { test } from "node:test";
import type { LauncherEvent } from "../tracking/launcher-event.ts";
import { runSlots } from "./run-slots.ts";

// runSlots never returns on its own, so a wait after the given count ends the test.
class Stop extends Error {}

// `rooms` answers roomForJob in turn, then there's room. A memory check registered with `every`
// runs once while the container does.
function fakes({ mintFails = false, waitsBeforeStop = 1, exitCode = 0, jobMs = 0, rooms = [] as (string | null)[] } = {}) {
  const events: string[] = [];
  const recorded: LauncherEvent[] = [];
  const checks: (() => Promise<void>)[] = [];
  let waits = 0;
  let time = 1_700_000_000_000;
  return {
    events,
    recorded,
    advance: (ms: number) => (time += ms),
    actions: {
      roomForJob: async () => rooms.shift() ?? null,
      release: async (runnerId: number) => {
        events.push(`release ${runnerId}`);
        return true;
      },
      every: (_ms: number, check: () => Promise<void>) => {
        checks.push(check);
        return () => void events.push("stop watching");
      },
      mint: async (name: string) => {
        events.push(`mint ${name}`);
        if (mintFails) throw new Error("GitHub returned 401");
        return { runnerId: 7, jitConfig: `registration-for-${name}` };
      },
      runContainer: async (slot: number, registration: string) => {
        events.push(`run ${slot} ${registration}`);
        for (const check of checks.splice(0)) await check();
        time += jobMs;
        return exitCode;
      },
      wait: async (ms: number) => {
        events.push(`wait ${ms}`);
        if (++waits >= waitsBeforeStop) throw new Stop();
      },
      now: () => time,
      log: (message: string) => void events.push(`log ${message}`),
      record: (event: LauncherEvent) => void recorded.push(event),
    },
  };
}

test("each runner gets its own registration, and the next starts after a short wait", async () => {
  const { actions, events } = fakes();
  await assert.rejects(runSlots("box", 1, actions), Stop);

  assert.deepEqual(events, [
    "mint box-1-1700000000",
    "run 1 registration-for-box-1-1700000000",
    "stop watching",
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

test("a slot's runner counts as registered only while its container runs", async () => {
  const { actions } = fakes();
  const registered = new Map<number, number>();
  const seen: (number | undefined)[] = [];
  const runContainer = actions.runContainer;
  actions.runContainer = async (slot, registration) => {
    seen.push(registered.get(slot));
    return runContainer(slot, registration);
  };

  await assert.rejects(runSlots("box", 1, actions, registered), Stop);
  assert.deepEqual(seen, [7]);
  assert.equal(registered.size, 0);
});

test("a slot registers nothing while memory is short, and says so once each way", async () => {
  const { actions, events } = fakes({ rooms: ["the VM is short", "the VM is short"], waitsBeforeStop: 3 });
  await assert.rejects(runSlots("box", 1, actions), Stop);

  assert.deepEqual(events.slice(0, 5), [
    "log slot 1: waiting for memory: the VM is short",
    "wait 15000",
    "wait 15000",
    "log slot 1: memory is back above the floor",
    "mint box-1-1700000000",
  ]);
});

test("an idle runner is removed when memory drops while it waits for a job", async () => {
  const { actions, events } = fakes({ rooms: [null, "the host is short"] });
  await assert.rejects(runSlots("box", 1, actions), Stop);

  assert.ok(events.includes("release 7"));
  assert.ok(events.includes("log slot 1: removed idle box-1-1700000000: the host is short"));
});

test("each runner and each wait for memory becomes one event", async () => {
  const { actions, recorded } = fakes({ rooms: ["the VM is short"], waitsBeforeStop: 2, jobMs: 90_000 });
  await assert.rejects(runSlots("box", 1, actions), Stop);

  assert.deepEqual(
    recorded.map(({ event }) => event),
    ["memory_wait", "runner"],
  );
  assert.deepEqual(recorded[1], {
    event: "runner",
    slot: 1,
    runner: "box-1-1700000000",
    startedAt: "2023-11-14T22:13:20.000Z",
    durationMs: 90_000,
    exitCode: 0,
    released: false,
  });
});
