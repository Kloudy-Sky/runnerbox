import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMemoryFloor, memAvailableMiB, vmStatAvailableMiB } from "./memory-floor.ts";

test("MemAvailable is read in MiB", () => {
  assert.equal(memAvailableMiB("MemTotal:  8000000 kB\nMemAvailable:  1572864 kB\n"), 1536);
  assert.throws(() => memAvailableMiB("MemTotal: 1 kB\n"), /no MemAvailable/);
});

test("macOS counts free, inactive and speculative pages as available, at vm_stat's page size", () => {
  const vmStat = [
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                                     4000.",
    "Pages active:                                 251798.",
    "Pages inactive:                               60000.",
    "Pages speculative:                              2000.",
    "Pages wired down:                             242734.",
  ].join("\n");
  assert.equal(vmStatAvailableMiB(vmStat), 1031);
  assert.throws(() => vmStatAvailableMiB("Pages free: 1.\n"), /no page counts/);
});

test("every machine must clear its floor, and an unreadable one has no room", async () => {
  const host = { name: "machine", floorMiB: 500, availableMiB: async () => 600 };
  const vm = (availableMiB: () => Promise<number>) => ({ name: "VM", floorMiB: 1500, availableMiB });

  assert.equal(await checkMemoryFloor([host, vm(async () => 2000)]), null);
  assert.equal(
    await checkMemoryFloor([host, vm(async () => 1000)]),
    "The VM has 1000 MB free. Runnerbox keeps 1.5 GB free before it starts another runner.",
  );
  assert.equal(
    await checkMemoryFloor([{ ...host, availableMiB: async () => 400 }, { ...vm(async () => 1840), floorMiB: 2048 }], "an image build"),
    "The machine has 400 MB free. Runnerbox keeps 500 MB free before it starts an image build. The VM has 1.8 GB free. Runnerbox keeps 2.0 GB free before it starts an image build.",
  );
  assert.equal(
    await checkMemoryFloor([host, { ...vm(async () => 2000), floorMiB: 2048 }]),
    "The VM has 2000 MB free. Runnerbox keeps 2048 MB free before it starts another runner.",
    "free and kept never read as the same amount",
  );
  assert.equal(
    await checkMemoryFloor([{ ...host, availableMiB: () => Promise.reject(new Error("spawn vm_stat ENOENT")) }, vm(async () => 1000)]),
    "Runnerbox couldn't read the machine's memory: spawn vm_stat ENOENT. The VM has 1000 MB free. Runnerbox keeps 1.5 GB free before it starts another runner.",
  );
});

test("a floor of 0 skips that machine's check entirely", async () => {
  const availableMiB = () => Promise.reject(new Error("no /proc here"));
  assert.equal(await checkMemoryFloor([{ name: "machine", floorMiB: 0, availableMiB }]), null);
});
