import assert from "node:assert/strict";
import { test } from "node:test";
import type { HealthDay } from "@runnerbox/contracts";
import { describeHealth } from "./healthWords.ts";

const day = (uptime: HealthDay["uptime"], extra: Partial<HealthDay> = {}): HealthDay => ({
  day: "2026-11-01", uptime, upMinutes: 0, downMinutes: 0, offMinutes: 0, lowestVmFreeMiB: 4096, jobsTaken: 0, failedBeforeJob: 0, failedByMachine: 0, ...extra,
});

test("a machine that sleeps nights and weekends reads as normal, not stopped", () => {
  const { status, sentence } = describeHealth({ install: "example", pauseBelowMiB: 2048, days: [day("up"), day("off"), day("off"), day("partial"), day("up")] });
  assert.equal(status, null);
  assert.match(sentence, /normal for a machine that sleeps/);
});

test("a machine whose runners fail today says it stopped, and why", () => {
  const { status, sentence } = describeHealth({ install: "example", pauseBelowMiB: 2048, days: [day("up"), day("down", { failedBeforeJob: 3 })] });
  assert.deepEqual(status, { text: "Stopped today", tone: "bad" });
  assert.match(sentence, /isn't taking jobs today: 3 runners failed/);
});

test("memory under the pause line reads as tight, and nearly out takes precedence", () => {
  const tight = describeHealth({ install: "example", pauseBelowMiB: 2048, days: [day("up", { lowestVmFreeMiB: 1500 }), day("up")] });
  assert.deepEqual(tight.status, { text: "Tight on memory", tone: "warn" });
  assert.match(tight.sentence, /fell below 2\.0 GB on 1 day/);
  const out = describeHealth({ install: "example", pauseBelowMiB: 2048, days: [day("up", { lowestVmFreeMiB: 1500 }), day("up", { lowestVmFreeMiB: 100 })] });
  assert.match(out.sentence, /nearly ran out on 1 day/);
});
