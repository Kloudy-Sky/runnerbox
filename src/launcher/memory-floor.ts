import type { LauncherConfig } from "./launcher-config.ts";

// MemAvailable from /proc/meminfo, in MiB. Linux reports it in kB.
export function memAvailableMiB(meminfo: string) {
  const kib = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo)?.[1];
  if (kib === undefined) throw new Error("/proc/meminfo has no MemAvailable line");
  return Math.floor(Number(kib) / 1024);
}

type Meminfo = { host: () => Promise<string>; vm: () => Promise<string> };

// Says why there's no room for another job, or null when both machines are above their floor. A
// machine whose memory can't be read has no room, since a job couldn't start there either.
export async function checkMemoryFloor(floor: LauncherConfig["memoryFloor"], meminfo: Meminfo) {
  const machines = [
    ["host", floor.hostMiB, meminfo.host],
    ["VM", floor.vmMiB, meminfo.vm],
  ] as const;
  const short: string[] = [];
  for (const [machine, floorMiB, read] of machines) {
    if (floorMiB === 0) continue;
    try {
      const available = memAvailableMiB(await read());
      if (available < floorMiB) short.push(`the ${machine} has ${available} MiB available, below its ${floorMiB} MiB floor`);
    } catch (error) {
      short.push(`couldn't read the ${machine}'s memory: ${error instanceof Error ? error.message : error}`);
    }
  }
  return short.length > 0 ? short.join("; ") : null;
}
