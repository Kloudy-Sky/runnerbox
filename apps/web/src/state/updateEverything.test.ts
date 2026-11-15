import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientPlatform, UpdateState } from "@runnerbox/client-runtime";

// The desktop app's updater, with its update downloaded and ready, and a record of the restart.
const installs: string[] = [];
const ready: UpdateState = { version: "0.4.0", channel: "stable", status: "ready", message: null, pending: "0.4.1", latest: "0.4.1", checkedAt: null };
const desktop: ClientPlatform = {
  catalog: { list: async () => [], save: async () => {}, remove: async () => {} },
  updates: { state: async () => ready, subscribe: () => () => {}, setChannel: async () => {}, check: async () => {}, install: async () => void installs.push("install") },
};
Object.assign(globalThis, { window: { runnerbox: desktop } });
const { afterServers, restartApp, useUpdateEverything } = await import("./updateEverything.ts");
const { useServerUpdates } = await import("./serverUpdates.ts");

const run = { target: "0.4.1", installsApp: true, phase: "servers" as const, restartAt: null, machines: [{ environmentId: "a", label: "example-a", startedAt: 0 }, { environmentId: "b", label: "example-b", startedAt: 0 }] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the app's restart counts down once every server's supervisor has its update", async () => {
  useUpdateEverything.setState({ run });
  useServerUpdates.setState({ runs: { a: { step: "starting", version: "0.4.1", updateId: "1" }, b: { step: "downloading", version: "0.4.1", received: 0, total: null } } });
  void afterServers(run);
  await settle();
  assert.equal(useUpdateEverything.getState().run?.phase, "servers", "example-b is still downloading");
  useServerUpdates.setState({ runs: { a: { step: "done", version: "0.4.1" }, b: { step: "starting", version: "0.4.1", updateId: "2" } } });
  await settle();
  assert.equal(useUpdateEverything.getState().run?.phase, "countdown");
  restartApp();
  assert.deepEqual(installs, ["install"]);
});

test("a server that fails holds the app's restart, so Retry stays on screen", async () => {
  useUpdateEverything.setState({ run });
  useServerUpdates.setState({ runs: { a: { step: "starting", version: "0.4.1", updateId: "1" }, b: { step: "refused", version: "0.4.1", detail: "GitHub answered 503 for runnerbox.js." } } });
  await afterServers(run);
  assert.deepEqual([useUpdateEverything.getState().run?.phase, useUpdateEverything.getState().run?.restartAt], ["servers", null]);
});
