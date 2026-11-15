import assert from "node:assert/strict";
import { test } from "node:test";
import { createContainerSampler } from "./container-sampler.ts";
import type { ContainerSample } from "./sample-record.ts";

const line = (name: string) => JSON.stringify({ Name: name, CPUPerc: "50.00%", MemUsage: "1GiB / 4GiB" });

// A sampler over scripted `docker stats` outputs, on a clock that only moves when it waits.
function scripted(outputs: (string | Error)[], { readMs = 2_000 } = {}) {
  let clock = 0;
  let reads = 0;
  let open = 0;
  let overlapped = false;
  const samples: ContainerSample[] = [];
  const waits: number[] = [];
  const sampler = createContainerSampler({
    read: async () => {
      open += 1;
      overlapped ||= open > 1;
      await Promise.resolve();
      clock += readMs;
      open -= 1;
      const output = outputs[reads++] ?? "";
      if (output instanceof Error) throw output;
      return output;
    },
    append: async (sample) => void samples.push(sample),
    ours: (name) => name.startsWith("example-"),
    intervalMs: 15_000,
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  const settled = () => new Promise((resolve) => setTimeout(resolve, 10));
  return { sampler, samples, waits, settled, reads: () => reads, overlapped: () => overlapped };
}

test("reads every interval, counting the read's own time, until none of the install's containers is left", async () => {
  const run = scripted([`${line("example-linux-slot1")}\n${line("other-slot1")}`, line("example-linux-slot1"), line("other-slot1")]);
  run.sampler.start();
  await run.settled();
  assert.equal(run.reads(), 3);
  // The third read found only another install's container, so it wasn't kept and the loop stopped.
  assert.deepEqual(run.samples.map((sample) => sample.containers.map(({ name }) => name)), [["example-linux-slot1", "other-slot1"], ["example-linux-slot1"]]);
  assert.deepEqual(run.samples.map((sample) => sample.time), [new Date(0).toISOString(), new Date(15_000).toISOString()]);
  assert.deepEqual(run.waits, [13_000, 13_000]);
});

test("reads before the container exists, or that fail, don't stop it until two intervals after the last start", async () => {
  // A runner reports itself before `docker run`, so the first read finds nothing.
  const run = scripted(["", line("example-linux-slot1"), "", new Error("ssh failed"), "", ""]);
  run.sampler.start();
  run.sampler.start();
  await run.settled();
  assert.equal(run.overlapped(), false);
  // Empty at 0 s (inside the grace), found at 15 s, empty at 30 s (past it): stopped.
  assert.equal(run.reads(), 3);
  assert.equal(run.samples.length, 1);
  // Started again: a failed read and an empty one inside the grace, then one past it.
  run.sampler.start();
  await run.settled();
  assert.equal(run.reads(), 6);
});
