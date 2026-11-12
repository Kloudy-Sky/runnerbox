import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { UpdateState } from "@runnerbox/client-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DesktopUpdates, layer, type UpdateHost } from "./DesktopUpdates.ts";
import { ElectronUpdater } from "./ElectronUpdater.ts";

const NIGHTLY = "0.2.1-nightly.20261113.42";

// A feed per channel, and a record of what the updater was asked to do.
function fakeUpdater(feeds: { latest: string | null; nightly: string | null }) {
  const calls: string[] = [];
  let channel: "latest" | "nightly" = "latest";
  const updater = Layer.succeed(ElectronUpdater)({
    configure: (feed) =>
      Effect.sync(() => {
        channel = feed.channel;
        calls.push(`configure ${feed.channel}`);
      }),
    check: Effect.sync(() => feeds[channel]),
    download: Effect.sync(() => void calls.push(`download ${feeds[channel]}`)),
    quitAndInstall: Effect.sync(() => void calls.push("install")),
  });
  return { updater, calls };
}

async function withUpdates(host: Partial<UpdateHost>, feeds: { latest: string | null; nightly: string | null }, use: (updates: DesktopUpdates["Service"], calls: string[], seen: UpdateState[]) => Effect.Effect<void>, userData?: string) {
  const dir = userData ?? (await mkdtemp(join(tmpdir(), "rbx-updates-")));
  const seen: UpdateState[] = [];
  const { updater, calls } = fakeUpdater(feeds);
  const full: UpdateHost = { version: NIGHTLY, userData: dir, disabledReason: null, broadcast: (state) => seen.push(state), now: () => new Date("2026-11-14T00:00:00Z"), ...host };
  try {
    await Effect.runPromise(Effect.scoped(Effect.flatMap(DesktopUpdates, (updates) => use(updates, calls, seen))).pipe(Effect.provide(layer(full).pipe(Layer.provide(updater)))));
  } finally {
    if (!userData) await rm(dir, { recursive: true, force: true });
  }
  return { calls, seen, dir };
}

test("a nightly user downloads a newer nightly, and restarting installs it", async () => {
  const { calls } = await withUpdates({}, { latest: "0.2.0", nightly: "0.2.1-nightly.20261114.43" }, (updates) =>
    Effect.gen(function* () {
      yield* updates.check;
      assert.deepEqual(yield* updates.state, { version: NIGHTLY, channel: "nightly", status: "ready", message: null, pending: "0.2.1-nightly.20261114.43", latest: "0.2.1-nightly.20261114.43", checkedAt: "2026-11-14T00:00:00.000Z" });
      yield* updates.install;
    }),
  );
  assert.deepEqual(calls, ["configure nightly", "download 0.2.1-nightly.20261114.43", "install"]);
});

test("switching a newer nightly to stable never downgrades: it waits for the next stable", async () => {
  const { calls } = await withUpdates({}, { latest: "0.2.0", nightly: "0.2.1-nightly.20261114.43" }, (updates) =>
    Effect.gen(function* () {
      yield* updates.setChannel("stable");
      yield* updates.check;
      const state = yield* updates.state;
      assert.deepEqual([state.channel, state.status, state.latest, state.pending], ["stable", "up-to-date", "0.2.0", null]);
      yield* updates.install;
    }),
  );
  assert.ok(!calls.some((call) => call.startsWith("download") || call === "install"));
  assert.ok(calls.includes("configure latest"));
});

test("an update downloaded on one channel isn't installed after switching to the other", async () => {
  const { calls } = await withUpdates({}, { latest: "0.2.0", nightly: "0.2.1-nightly.20261114.43" }, (updates) =>
    Effect.gen(function* () {
      yield* updates.check;
      assert.equal((yield* updates.state).status, "ready");
      yield* updates.setChannel("stable");
      yield* updates.check;
      yield* updates.install;
      assert.equal((yield* updates.state).pending, null);
    }),
  );
  assert.deepEqual(calls.filter((call) => call === "install"), []);
});

test("a build with no feed never asks the updater anything", async () => {
  const { calls, seen } = await withUpdates({ version: "0.0.0", disabledReason: "This build runs from a checkout, so it doesn't update itself." }, { latest: "0.2.0", nightly: null }, (updates) =>
    Effect.gen(function* () {
      yield* updates.check;
      yield* updates.setChannel("nightly");
      yield* updates.install;
    }),
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(seen.map((state) => [state.status, state.channel]), [["disabled", "stable"], ["disabled", "nightly"]]);
});

test("the channel picked stays picked after a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rbx-updates-"));
  try {
    await withUpdates({ version: "0.2.0" }, { latest: null, nightly: null }, (updates) => updates.setChannel("nightly"), dir);
    await withUpdates({ version: "0.2.0" }, { latest: null, nightly: null }, (updates) => Effect.map(updates.state, (state) => assert.equal(state.channel, "nightly")), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
