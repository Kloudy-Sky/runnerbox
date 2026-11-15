import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost } from "./hostedRates.ts";

const MINUTE = 60_000;

test("minutes are rounded up per job and priced at the smallest hosted Linux size with enough CPUs", () => {
  // 30 s and 61 s bill as 1 and 2 minutes; 3 CPUs needs the 4-core size.
  assert.deepEqual(estimateCost([30_000, 61_000, 10 * MINUTE], { runsIn: "container", cpus: 3 }), { usd: 0.16, minutes: 13, size: "4-core Linux", usdPerMinute: 0.012 });
  assert.equal(estimateCost([MINUTE], { runsIn: "container", cpus: 2 })?.size, "2-core Linux");
});

test("a host install is priced as macOS, and a kind with no CPU limit or more CPUs than any hosted size isn't priced", () => {
  assert.equal(estimateCost([10 * MINUTE], { runsIn: "host", cpus: null })?.usd, 0.62);
  assert.equal(estimateCost([MINUTE], { runsIn: "container", cpus: null }), null);
  assert.equal(estimateCost([MINUTE], { runsIn: "container", cpus: 128 }), null);
});
