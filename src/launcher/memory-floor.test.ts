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
  const host = { name: "host", floorMiB: 500, availableMiB: async () => 600 };
  const vm = (availableMiB: () => Promise<number>) => ({ name: "VM", floorMiB: 1500, availableMiB });

  assert.equal(await checkMemoryFloor([host, vm(async () => 2000)]), null);
  assert.equal(
    await checkMemoryFloor([host, vm(async () => 1000)]),
    "the VM has 1000 MiB available, below its 1500 MiB floor",
  );
  assert.match(
    (await checkMemoryFloor([host, vm(() => Promise.reject(new Error("ssh timed out")))])) ?? "",
    /couldn't read the VM's memory: ssh timed out/,
  );
});

test("a floor of 0 skips that machine's check entirely", async () => {
  const availableMiB = () => Promise.reject(new Error("no /proc here"));
  assert.equal(await checkMemoryFloor([{ name: "host", floorMiB: 0, availableMiB }]), null);
});
