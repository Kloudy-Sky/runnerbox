import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMemoryFloor, memAvailableMiB } from "./memory-floor.ts";

const meminfo = (availableMiB: number) => `MemTotal:  8000000 kB\nMemAvailable:  ${availableMiB * 1024} kB\n`;

test("MemAvailable is read in MiB", () => {
  assert.equal(memAvailableMiB(meminfo(1536)), 1536);
  assert.throws(() => memAvailableMiB("MemTotal: 1 kB\n"), /no MemAvailable/);
});

test("both machines must clear their floor, and an unreadable one has no room", async () => {
  const floor = { hostMiB: 500, vmMiB: 1500 };
  const host = async () => meminfo(600);

  assert.equal(await checkMemoryFloor(floor, { host, vm: async () => meminfo(2000) }), null);
  assert.equal(
    await checkMemoryFloor(floor, { host, vm: async () => meminfo(1000) }),
    "the VM has 1000 MiB available, below its 1500 MiB floor",
  );
  assert.match(
    (await checkMemoryFloor(floor, { host, vm: () => Promise.reject(new Error("ssh timed out")) })) ?? "",
    /couldn't read the VM's memory: ssh timed out/,
  );
});

test("a floor of 0 skips that machine's check entirely", async () => {
  const unreadable = () => Promise.reject(new Error("no /proc here"));
  assert.equal(await checkMemoryFloor({ hostMiB: 0, vmMiB: 0 }, { host: unreadable, vm: unreadable }), null);
});
