import assert from "node:assert/strict";
import { test } from "node:test";
import type { KindUsage } from "@runnerbox/contracts";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import { machineFit } from "./machineFit.ts";

const T0 = Date.parse("2026-06-10T12:00:00Z"); // a Wednesday
const MINUTE = 60_000;
// A sample a minute for an hour, with free memory dropping to 1,000 MB for `low` minutes.
const samples = (low: number): InstallSample[] =>
  Array.from({ length: 60 }, (_, index) => ({ install: "example", sample: { time: new Date(T0 + index * MINUTE).toISOString(), vm: { totalMiB: 16_384, availableMiB: index < low ? 1000 : 8000, swapUsedMiB: 0, load1: 1 } } }));
const floor = (vmMiB?: number) => () => vmMiB ?? null;
const bottleneck = { install: "example", kind: "linux", bottleneck: { cause: "slots", text: "" } } as KindUsage;

test("with the floor recorded, it says how long free memory was under it, and that more runners need memory first", () => {
  const [fit] = machineFit(["example"], floor(1536), samples(9), [bottleneck]);
  assert.equal(fit!.floorMiB, 1536);
  assert.equal(fit!.sentence, "Free memory fell under the 1.5 GB that Runnerbox keeps free on 1 day, for 9 minutes in all, and new jobs waited then. Adding more linux runners would need more memory first.");
  assert.equal(machineFit(["example"], floor(1536), samples(0), [bottleneck])[0]!.sentence, "Free memory stayed above the 1.5 GB that Runnerbox keeps free the whole time.");
});

test("without the floor it says how low memory went and that the records don't say, and a machine with no samples says so", () => {
  assert.equal(
    machineFit(["example"], floor(), samples(1), [])[0]!.sentence,
    "Free memory went as low as 1.0 GB of 16.0 GB, on Wednesday. The machine's records don't say how much memory Runnerbox keeps free.",
  );
  assert.equal(machineFit(["other"], floor(), samples(1), [])[0]!.sentence, "No memory readings for this machine yet. They come from Runnerbox running on it.");
});
