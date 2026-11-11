import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { parseContainer, parseCpuCounters, parseMeminfo } from "./machine-sample.ts";
import { createRotatingLog } from "./rotating-log.ts";
import type { Sample } from "./sample-record.ts";
import { createSampler, splitSections, VM_SAMPLE_COMMAND } from "./sampler.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-sampler-"));
after(() => rm(dir, { recursive: true }));

// A docker that fails like a timed-out one, and a timeout that just runs its command.
const fakeBin = join(dir, "bin");
await mkdir(fakeBin);
await writeFile(join(fakeBin, "docker"), "#!/bin/bash\nexit 124\n");
await writeFile(join(fakeBin, "timeout"), '#!/bin/bash\nshift; exec "$@"\n');
await chmod(join(fakeBin, "docker"), 0o755);
await chmod(join(fakeBin, "timeout"), 0o755);

const meminfo = (availableMiB: number, swapFreeMiB: number) =>
  `MemTotal: ${4096 * 1024} kB\nMemFree: 1 kB\nMemAvailable: ${availableMiB * 1024} kB\nSwapTotal: ${4096 * 1024} kB\nSwapFree: ${swapFreeMiB * 1024} kB\n`;

test("meminfo gives total, available and swap in use", () => {
  assert.deepEqual(parseMeminfo(meminfo(1000, 3072)), { totalMiB: 4096, availableMiB: 1000, swapUsedMiB: 1024 });
  assert.equal(parseMeminfo("MemTotal: 1 kB\n"), undefined);
});

test("docker stats lines give each container's CPU and memory, whatever the unit", () => {
  assert.deepEqual(parseContainer('{"Name":"box-slot1","CPUPerc":"12.50%","MemUsage":"1.5GiB / 3.5GiB"}'), {
    name: "box-slot1",
    cpuPercent: 12.5,
    memMiB: 1536,
  });
  assert.equal(parseContainer('{"Name":"x","CPUPerc":"--","MemUsage":"0B / 0B"}'), undefined);
  assert.equal(parseContainer("not json"), undefined);
});

test("a sample has both machines and every container, with CPU from the second sample on", async () => {
  const samples: Sample[] = [];
  let [busy, idle] = [100, 900];
  const vm = () =>
    Promise.resolve(
      `@@meminfo\n${meminfo(900, 4096)}@@loadavg\n2.50 1.00 0.50 1/100 42\n@@stat\ncpu ${busy} 0 0 ${idle} 0\n` +
        '@@containers\n{"Name":"box-slot1","CPUPerc":"50%","MemUsage":"700MiB / 3GiB"}\n',
    );
  const sample = createSampler({
    readHost: () => Promise.reject(new Error("no /proc on this machine")),
    readVm: vm,
    append: async (record) => void samples.push(record),
    now: () => 0,
  });

  await sample();
  [busy, idle] = [130, 970];
  await sample();

  assert.equal(samples[0]?.host, undefined);
  assert.deepEqual(samples[0]?.vm, { totalMiB: 4096, availableMiB: 900, swapUsedMiB: 0, load1: 2.5 });
  assert.equal(samples[1]?.vm?.cpuBusyPercent, 30);
  assert.deepEqual(samples[1]?.containers, [{ name: "box-slot1", cpuPercent: 50, memMiB: 700 }]);
});

test("the log rolls over past its size and keeps a bounded number of files", async () => {
  const logDir = join(dir, "logs");
  const log = createRotatingLog(join(logDir, "events.ndjson"), { maxBytes: 50, keep: 2 });
  for (let index = 0; index < 20; index++) await log.append({ index, padding: "xxxxxxxxxx" });

  assert.deepEqual((await readdir(logDir)).sort(), ["events.ndjson", "events.ndjson.1", "events.ndjson.2"]);
  const last = (await readFile(join(logDir, "events.ndjson"), "utf8")).trim().split("\n").at(-1) ?? "";
  assert.equal(JSON.parse(last).index, 19);
});

test("guest time isn't counted twice, and steal isn't busy", () => {
  // user=50 nice=0 system=0 idle=40 iowait=0 irq=0 softirq=0 steal=10 guest=50 guest_nice=0
  assert.deepEqual(parseCpuCounters("cpu 50 0 0 40 0 0 0 10 50 0"), { busy: 50, total: 100 });
});

test("the VM command keeps its sections when Docker times out", { skip: process.platform === "win32" && "the stand-in is a bash script" }, () => {
  const output = execFileSync("bash", ["-c", VM_SAMPLE_COMMAND], {
    encoding: "utf8",
    env: { PATH: `${fakeBin}:/usr/bin:/bin` },
  });
  const sections = splitSections(output);
  assert.deepEqual(Object.keys(sections), ["meminfo", "loadavg", "stat"]);
});
