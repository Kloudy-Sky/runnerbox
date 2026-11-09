import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { machineDuringJobs } from "./job-machine.ts";
import { readSamples } from "./sample-log.ts";
import type { Sample } from "./sample-record.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-samples-"));
after(() => rm(dir, { recursive: true }));

const vm = (availableMiB: number, swapUsedMiB: number) => ({ totalMiB: 4096, availableMiB, swapUsedMiB, load1: 1 });
const sample = (time: string, availableMiB: number, swapUsedMiB: number): Sample => ({ time, vm: vm(availableMiB, swapUsedMiB) });

const job = { runner: "rb-linux-1-1794160988", startedAt: "2026-01-01T00:10:00Z", completedAt: "2026-01-01T00:20:00Z" };

test("a job gets the lowest memory and most swap among samples taken while it ran, with clock slack", () => {
  const during = machineDuringJobs(
    [
      sample("2026-01-01T00:09:00Z", 100, 4000), // before the job and its slack
      sample("2026-01-01T00:09:45Z", 1200, 200), // inside the slack
      sample("2026-01-01T00:15:00Z", 700, 900),
      sample("2026-01-01T00:21:00Z", 50, 4000), // after
    ].map((found) => ({ install: "rb", sample: found })),
  );
  assert.deepEqual(during(job), { samples: 2, vmLowMiB: 700, vmSwapPeakMiB: 900 });
});

test("a job with no samples, or no runner, has no machine data", () => {
  const during = machineDuringJobs([{ install: "rb", sample: sample("2026-01-02T00:00:00Z", 100, 0) }]);
  assert.equal(during(job), undefined);
  assert.equal(during({ ...job, runner: null }), undefined);
});

test("samples from every install and rotated file are read in time order, skipping bad lines", async () => {
  await mkdir(join(dir, "a"));
  await mkdir(join(dir, "b"));
  await writeFile(join(dir, "a", "samples.ndjson"), `${JSON.stringify(sample("2026-01-01T00:03:00Z", 1, 0))}\nnot json\n`);
  await writeFile(join(dir, "a", "samples.ndjson.1"), `${JSON.stringify(sample("2026-01-01T00:01:00Z", 1, 0))}\n`);
  await writeFile(join(dir, "b", "samples.ndjson"), `${JSON.stringify(sample("2026-01-01T00:02:00Z", 1, 0))}\n{"time":1}\n`);

  assert.deepEqual(
    (await readSamples(dir)).map(({ install, sample: found }) => `${install} ${found.time}`),
    ["a 2026-01-01T00:01:00Z", "b 2026-01-01T00:02:00Z", "a 2026-01-01T00:03:00Z"],
  );
});

test("a runner that isn't the install's, hosted or another launcher's, gets none of its samples", () => {
  const during = machineDuringJobs([{ install: "rb", sample: sample("2026-01-01T00:15:00Z", 700, 900) }]);
  for (const runner of ["GitHub Actions 3", "old-box-1", "rbx-linux-1-1794160988"]) {
    assert.equal(during({ ...job, runner }), undefined, runner);
  }
});
