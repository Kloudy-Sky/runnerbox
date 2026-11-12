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
  channel: "",
  force: false,
  promote: "",
  nightlyEnabled: true,
  tags: ["v0.2.0", "v0.2.1-nightly.20261112.41", "v0.2.1-nightly.20261113.42"],
  commitOf: (tag) => (tag === "v0.2.1-nightly.20261113.42" ? "b".repeat(40) : "a".repeat(40)),
  shippedNightly: () => true,
  ...overrides,
});

test("the schedule publishes nothing until NIGHTLY_ENABLED is set", () => {
  const off = planRelease(input({ nightlyEnabled: false }));
  assert.deepEqual(off, { mode: "skip", reason: "scheduled nightlies are off. Set the repository variable NIGHTLY_ENABLED to true to turn them on." });
});

test("a nightly dispatched by hand follows the schedule's rules, and force runs it on an unchanged main", () => {
  const dispatched = { event: "workflow_dispatch", channel: "nightly", nightlyEnabled: false } as const;
  assert.deepEqual(planRelease(input(dispatched)), planRelease(input({})));
  assert.equal(planRelease(input({ ...dispatched, sha: "b".repeat(40) })).mode, "skip");
  assert.deepEqual(planRelease(input({ ...dispatched, sha: "b".repeat(40), force: true })), {
    mode: "nightly",
    tag: "v0.2.1-nightly.20261114.50",
    version: "0.2.1-nightly.20261114.50",
    sha: "b".repeat(40),
  });
  assert.throws(() => planRelease(input({ ...dispatched, refName: "feature" })), /from main/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "preview" })), /no preview channel/);
});

test("a scheduled run ships a nightly only when main moved since the last one", () => {
  assert.deepEqual(planRelease(input({})), { mode: "nightly", tag: "v0.2.1-nightly.20261114.50", version: "0.2.1-nightly.20261114.50", sha: "c".repeat(40) });
  assert.equal(planRelease(input({ sha: "b".repeat(40) })).mode, "skip");
});

test("a stable release ships the commit of a nightly, and never one that isn't newer", () => {
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "stable", refName: "feature" })), /from main/);
  assert.deepEqual(planRelease(input({ event: "workflow_dispatch", channel: "stable" })), { mode: "stable", tag: "v0.2.1", version: "0.2.1", sha: "b".repeat(40) });
  assert.deepEqual(planRelease(input({ event: "workflow_dispatch", channel: "stable", promote: "v0.2.1-nightly.20261112.41" })), { mode: "stable", tag: "v0.2.1", version: "0.2.1", sha: "a".repeat(40) });
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "stable", tags: ["v0.2.0"] })), /no nightly/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "stable", tags: [...input({}).tags, "v0.2.1"] })), /already released/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "stable", tags: ["v0.3.0", "v0.2.1-nightly.20261113.42"] })), /isn't newer/);
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "stable", promote: "v0.2.1" })), /isn't a tag|isn't a nightly/);
});

test("a tag someone pushed that only looks like a nightly is never promoted or counted", () => {
  // The workflow's own nightly is .41; .42 was pushed by hand, or isn't on main.
  const shippedNightly = (tag: string) => tag === "v0.2.1-nightly.20261112.41";
  assert.deepEqual(planRelease(input({ event: "workflow_dispatch", channel: "stable", shippedNightly })), { mode: "stable", tag: "v0.2.1", version: "0.2.1", sha: "a".repeat(40) });
  assert.throws(() => planRelease(input({ event: "workflow_dispatch", channel: "stable", promote: "v0.2.1-nightly.20261113.42", shippedNightly })), /isn't a nightly this workflow published/);
  // Main matching the planted tag's commit doesn't skip a nightly.
  assert.equal(planRelease(input({ sha: "b".repeat(40), shippedNightly })).mode, "nightly");
});

test("a pushed tag still releases runnerbox.js on its own", () => {
  assert.deepEqual(planRelease(input({ event: "push", refName: "v0.2.0-rc.4", sha: "d".repeat(40) })), { mode: "cli", tag: "v0.2.0-rc.4", version: "0.2.0-rc.4", sha: "d".repeat(40) });
});
