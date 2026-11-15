import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpdateState } from "@runnerbox/client-runtime";
import { describeRow, type MachineFacts, planUpdate, SLOW_AFTER_MS, targetVersion } from "./updateEverything.ts";

const desktop = (status: UpdateState["status"], pending: string | null): UpdateState => ({ version: "0.4.0", channel: "stable", status, message: null, pending, latest: pending, checkedAt: null });

test("servers move to the version this app is installing, else to the app's own", () => {
  assert.equal(targetVersion("0.4.0", desktop("ready", "0.4.1")), "0.4.1");
  assert.equal(targetVersion("0.4.0", desktop("downloading", "0.4.1")), "0.4.1");
  assert.equal(targetVersion("0.4.0", desktop("up-to-date", null)), "0.4.0");
  assert.equal(targetVersion("0.4.0", null), "0.4.0", "a browser has no app update, so its own version");
  assert.equal(targetVersion("0.0.0", desktop("disabled", null)), null, "a build from a checkout has no release");
});

const ready: MachineFacts = { environmentId: "a", label: "example-a", reach: "direct", serverVersion: "0.4.0", canWrite: true, selfUpdates: true, blocker: null, release: "valid", updating: false };
const machine = (label: string, change: Partial<MachineFacts>): MachineFacts => ({ ...ready, environmentId: label, label, ...change });

test("each server that can't move is skipped with the reason, and current ones aren't mentioned", () => {
  const plan = planUpdate(
    [
      ready,
      machine("current", { serverVersion: "0.4.1" }),
      machine("offline", { reach: "offline", serverVersion: "0.3.0" }),
      machine("offline-current", { reach: "offline", serverVersion: "0.4.1" }),
      machine("connect", { reach: "connect" }),
      machine("read-only", { canWrite: false }),
      machine("old", { serverVersion: "0.0.0", selfUpdates: false }),
      machine("busy", { blocker: "turn-running" }),
      machine("unsigned", { release: "missing" }),
      machine("unreleased", { release: { failed: "GitHub answered 404 for runnerbox.js.sha256." } }),
      machine("older-server", { release: "unchecked" }),
    ],
    "0.4.1",
  );
  assert.deepEqual(
    plan.servers.map((server) => server.label),
    ["example-a", "older-server"],
  );
  assert.deepEqual(
    plan.skipped.map(({ label, reason }) => [label, reason]),
    [
      ["offline", "offline"],
      ["connect", "reached only over Connect"],
      ["read-only", "paired without the right to manage it"],
      ["old", "needs a manual update"],
      ["busy", "an agent is answering in a thread"],
      ["unsigned", "0.4.1 isn't signed"],
      ["unreleased", "no runnerbox.js for 0.4.1 yet"],
    ],
  );
});

test("a server is still being checked until its blocker and release are known", () => {
  const plan = planUpdate([machine("asking", { release: undefined }), machine("unknown", { serverVersion: undefined })], "0.4.1");
  assert.deepEqual([plan.servers, plan.checking.map(({ label }) => label)], [[], ["asking", "unknown"]]);
});

test("the row counts progress, names a slow machine, and holds on a failure with Retry", () => {
  const now = 1_000_000;
  const started = now - 60_000;
  assert.deepEqual(describeRow("servers", null, [{ label: "example-a", startedAt: started, status: "done" }, { label: "example-b", startedAt: started, status: "downloading" }], "ready", now).label, "1 of 2 updated");
  const slow = describeRow("servers", null, [{ label: "example-b", startedAt: now - SLOW_AFTER_MS - 60_000, status: "downloading" }], "ready", now);
  assert.deepEqual([slow.tone, slow.label, slow.elapsed], ["slow", "example-b downloading", "4m"]);
  const failed = describeRow("servers", null, [{ label: "example-a", startedAt: started, status: "restarting" }, { label: "example-b", startedAt: started, status: "failed" }], "ready", now);
  assert.deepEqual([failed.tone, failed.label, failed.action], ["failed", "example-b failed", "retry"]);
  assert.deepEqual(describeRow("countdown", now + 10_000, [], "ready", now), { tone: "default", label: "App restarts in 10s", elapsed: null, action: "later" });
});
