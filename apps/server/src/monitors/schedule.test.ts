import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MonitorSettings } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";
import { layerCore } from "../server.ts";
import { makeFakeProvider } from "../testing/FakeProvider.ts";
import { writeFixtures } from "../testing/fixtures.ts";
import * as Monitors from "./Monitors.ts";

// Two of the fixtures' "Needs you" items.
const ITEM = "failure:owner/name\u0000ci\u0000test:infra";
const SLOT = "failing_slot:example:docker";
const ON: MonitorSettings = { enabled: true, dailyLimit: 5, accountId: null, model: null };

// The monitor on a fake clock, over the real services and fixture logs, so its 15-minute schedule
// runs only when the test moves the clock.
async function start() {
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-schedule-test-"));
  await writeFixtures(stateDir, Date.now());
  const fake = makeFakeProvider({ turns: [[{ text: "Looked." }], [{ text: "Looked again." }]] });
  const clock = TestClock.layer();
  const layer = Layer.mergeAll(clock, Monitors.layer.pipe(Layer.provide(clock), Layer.provideMerge(layerCore({ stateDir, host: "127.0.0.1", port: 1, provider: fake.layer }))));
  const scope = Effect.runSync(Scope.make());
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  const monitors = Context.get(context, Monitors.Monitors);
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.provide(context)));
  return {
    fake,
    save: (settings: MonitorSettings) => run(monitors.save(settings)),
    status: () => run(monitors.status(true)),
    advance: (minutes: number) => run(TestClock.adjust(`${minutes} minutes`)),
    // As though these items had just appeared.
    arrive: async (ids: ReadonlyArray<string>) => {
      const path = join(stateDir, ".server", "monitor.json");
      const state = JSON.parse(await readFile(path, "utf8"));
      for (const id of ids) delete state.seen[id];
      await writeFile(path, JSON.stringify(state));
    },
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}
type Monitor = Awaited<ReturnType<typeof start>>;

// Waits on real time for a pass the fake clock started, then lets it settle into its next wait.
async function settle(monitor: Monitor, looks: number) {
  for (let tries = 0; tries < 50; tries++) {
    const { runs } = await monitor.status();
    if (monitor.fake.inputs.length >= looks && runs.every((run) => run.outcome !== "running")) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test("while monitors are on, a pass runs every 15 minutes", async () => {
  const monitor = await start();
  try {
    await monitor.save(ON);
    await monitor.arrive([ITEM]);
    await monitor.advance(15);
    await settle(monitor, 1);
    assert.equal(monitor.fake.inputs.length, 1);
    await monitor.arrive([SLOT]);
    await monitor.advance(14);
    await settle(monitor, 2);
    assert.equal(monitor.fake.inputs.length, 1, "no pass before 15 minutes have gone by");
    await monitor.advance(1);
    await settle(monitor, 2);
    assert.equal(monitor.fake.inputs.length, 2);
  } finally {
    await monitor.close();
  }
});

test("while monitors are off, the schedule starts no look", async () => {
  const monitor = await start();
  try {
    await monitor.save(ON);
    await monitor.save({ ...ON, enabled: false });
    await monitor.arrive([ITEM, SLOT]);
    await monitor.advance(15);
    await settle(monitor, 1);
    await monitor.advance(15);
    await settle(monitor, 1);
    assert.equal(monitor.fake.inputs.length, 0);
  } finally {
    await monitor.close();
  }
});
