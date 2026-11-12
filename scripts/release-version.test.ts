import assert from "node:assert/strict";
import { test } from "node:test";
import semver from "semver";
import { planRelease, type PlanInput } from "./release-plan.ts";
import { channelOf, nextStable, nightlyVersion, stableOf } from "./release-version.ts";

const day = (iso: string) => new Date(`${iso}T03:00:00Z`);

test("a nightly user moves to the next stable and never sorts above it, and the next nightly passes it", () => {
  const before = ["v0.2.0-rc.3", "v0.2.0"];
  const first = nightlyVersion(nextStable(before), day("2026-11-12"), 41);
  const second = nightlyVersion(nextStable([...before, `v${first}`]), day("2026-11-13"), 42);
  assert.deepEqual([first, second], ["0.2.1-nightly.20261112.41", "0.2.1-nightly.20261113.42"]);
  assert.ok(semver.gt(first, "0.2.0") && semver.gt(second, first));
  const stable = stableOf(`v${second}`);
  assert.equal(stable, "0.2.1");
  assert.ok(semver.gt(stable, second), "the stable a nightly previews is an update for that nightly's users");
  const after = nightlyVersion(nextStable([...before, `v${first}`, `v${second}`, `v${stable}`]), day("2026-11-14"), 43);
  assert.equal(after, "0.2.2-nightly.20261114.43");
  assert.ok(semver.gt(after, stable));
  // Two runs on one day still order by run number.
  assert.ok(semver.gt("0.2.1-nightly.20261113.100", "0.2.1-nightly.20261113.99"));
});

test("the next stable follows the newest release, including a prerelease heading past it", () => {
  assert.equal(nextStable([]), "0.1.0");
  assert.equal(nextStable(["v0.1.0-rc.9", "v0.2.0-rc.3"]), "0.2.0");
  assert.equal(nextStable(["v0.2.0", "v0.2.0-rc.3"]), "0.2.1");
  assert.equal(nextStable(["v0.2.0", "v0.3.0-rc.1", "not-a-version"]), "0.3.0");
});

test("only a nightly version is on the nightly feed", () => {
  assert.equal(channelOf("0.2.1-nightly.20261112.41"), "nightly");
  assert.equal(channelOf("0.2.1"), "latest");
  assert.equal(channelOf("0.2.0-rc.3"), "latest");
});

const input = (overrides: Partial<PlanInput>): PlanInput => ({
  event: "schedule",
  refName: "main",
  sha: "c".repeat(40),
  runNumber: 50,
  runStartedAt: day("2026-11-14"),
  promote: "",
  tags: ["v0.2.0", "v0.2.1-nightly.20261112.41", "v0.2.1-nightly.20261113.42"],
  commitOf: (tag) => (tag === "v0.2.1-nightly.20261113.42" ? "b".repeat(40) : "a".repeat(40)),
  ...overrides,
});

test("a scheduled run ships a nightly only when main moved since the last one", () => {
  assert.deepEqual(planRelease(input({})), { mode: "nightly", tag: "v0.2.1-nightly.20261114.50", version: "0.2.1-nightly.20261114.50", sha: "c".repeat(40) });
  assert.equal(planRelease(input({ sha: "b".repeat(40) })).mode, "skip");
});

test("a stable release ships the commit of a nightly, and never one that isn't newer", () => {
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", refName: "feature" })), /from main/);
  assert.deepEqual(planRelease(input({ event: "workflow_dispatch" })), { mode: "stable", tag: "v0.2.1", version: "0.2.1", sha: "b".repeat(40) });
  assert.deepEqual(planRelease(input({ event: "workflow_dispatch", promote: "v0.2.1-nightly.20261112.41" })), { mode: "stable", tag: "v0.2.1", version: "0.2.1", sha: "a".repeat(40) });
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", tags: ["v0.2.0"] })), /no nightly/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", tags: [...input({}).tags, "v0.2.1"] })), /already released/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", tags: ["v0.3.0", "v0.2.1-nightly.20261113.42"] })), /isn't newer/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", promote: "v0.2.1" })), /isn't a tag|isn't a nightly/);
});

test("a pushed tag still releases runnerbox.js on its own", () => {
  assert.deepEqual(planRelease(input({ event: "push", refName: "v0.2.0-rc.4", sha: "d".repeat(40) })), { mode: "cli", tag: "v0.2.0-rc.4", version: "0.2.0-rc.4", sha: "d".repeat(40) });
});
