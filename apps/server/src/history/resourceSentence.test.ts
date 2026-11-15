import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlacedStep, ResourcePoint } from "@runnerbox/contracts";
import { resourceSentence, type SentenceInput } from "./resourceSentence.ts";

const SECOND = 1000;
// A 120 s job: Install for 30 s, then Test for 90 s.
const steps = (exact = true): PlacedStep[] => [
  { name: "Install", conclusion: "success", offsetMs: 0, ms: 30 * SECOND, exact },
  { name: "Test", conclusion: "success", offsetMs: 30 * SECOND, ms: 90 * SECOND, exact },
];
// A reading every 15 s, from `pick` at each offset in seconds.
const points = (pick: (second: number) => Partial<ResourcePoint> = () => ({})): ResourcePoint[] =>
  [0, 15, 30, 45, 60, 75, 90, 105, 120].map((second) => ({ offsetMs: second * SECOND, memMiB: 1000, cpuPercent: 40, ...pick(second) }));

const input = (overrides: Partial<SentenceInput> = {}): SentenceInput => ({
  coverage: "sampled",
  steps: steps(),
  points: points(),
  vm: [{ offsetMs: 0, availableMiB: 8000, totalMiB: 16_384 }],
  limits: { memoryMiB: 4096, cpus: 2 },
  stoppedForMemory: null,
  durationMs: 120 * SECOND,
  ...overrides,
});
const say = (overrides: Partial<SentenceInput> = {}) => resourceSentence(input(overrides));

test("memory reaching the limit names the step it reached it in, and only when that step's time is known", () => {
  const high = points((second) => (second === 60 ? { memMiB: 4000 } : {}));
  assert.deepEqual(say({ points: high }), { case: "memory_limit", text: "Memory reached this kind's 4.0 GB limit in Test.", step: "Test", advice: "Raise this kind's memory limit, or make the Test step use less." });
  // Steps placed by adding up lengths: the reading may not be in Test, so no step is named.
  assert.deepEqual(say({ points: high, steps: steps(false) }), { case: "memory_limit", text: "Memory reached this kind's 4.0 GB limit while this job ran.", step: null, advice: "Raise this kind's memory limit, or make this job use less." });
});

test("a container stopped for memory comes first, with the step it was stopped in, even with no readings of it", () => {
  assert.equal(say({ stoppedForMemory: { offsetMs: 50 * SECOND, step: "Test" } })?.text, "The container was stopped for using too much memory during Test, at its 4.0 GB limit.");
  assert.equal(say({ coverage: "no_samples", points: [], stoppedForMemory: { offsetMs: 38 * SECOND, step: "Test" } })?.case, "stopped_for_memory");
});

test("CPU at the limit for most of a long step names that step", () => {
  const busy = points((second) => (second >= 30 ? { cpuPercent: 195 } : {}));
  assert.deepEqual(say({ points: busy }), { case: "cpu_limit", text: "CPU was at this kind's limit of 2 CPUs for most of Test, so that step was held back by CPU.", step: "Test", advice: "Give this kind more CPUs, or expect Test to take this long." });
  // A brief spike isn't most of anything, but the sentence doesn't call it under the limit either.
  const spike = say({ points: points((second) => (second === 45 ? { cpuPercent: 200 } : {})) });
  assert.equal(spike?.case, "nothing_unusual");
  assert.match(spike!.text, /CPU reached its limit of 2 CPUs only for short stretches\.$/);
});

test("a VM low on memory while the job stayed well under its own limit says so without blaming the job", () => {
  assert.equal(say({ vm: [{ offsetMs: 30 * SECOND, availableMiB: 900, totalMiB: 16_384 }] })?.text, "The VM ran low on memory while this job ran, though the job itself stayed well under its limit.");
});

test("an ordinary job says nothing unusual, with its highest reading, and nothing to do", () => {
  assert.equal(say()?.advice, null);
  assert.equal(say()?.text, "Nothing unusual: the highest reading was 1.0 GB of its 4.0 GB memory limit, and CPU stayed under its limit of 2 CPUs.");
  assert.equal(say({ limits: null })?.text, "Nothing unusual: the highest memory reading was 1000 MB.");
});

test("too few readings, or readings over only part of the job, say too little is known", () => {
  assert.equal(say({ points: points().slice(0, 1), durationMs: 40 * SECOND })?.text, "Only 1 reading was taken while this job ran, too few to say more.");
  assert.equal(say({ points: points().slice(0, 4) })?.text, "The readings cover only part of this job, too little to say more.");
});
