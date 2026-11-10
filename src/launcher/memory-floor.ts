// MemAvailable from /proc/meminfo, in MiB. Linux reports it in kB.
export function memAvailableMiB(meminfo: string) {
  const kib = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo)?.[1];
  if (kib === undefined) throw new Error("/proc/meminfo has no MemAvailable line");
  return Math.floor(Number(kib) / 1024);
}

// What macOS could hand to a new job without swapping, from `vm_stat`, in MiB: free pages, plus the
// inactive and speculative ones it reclaims first. macOS has no MemAvailable of its own.
export function vmStatAvailableMiB(vmStat: string) {
  const pageSize = /page size of (\d+) bytes/.exec(vmStat)?.[1];
  const pages = ["free", "inactive", "speculative"].map((kind) => new RegExp(`^Pages ${kind}:\\s+(\\d+)\\.$`, "m").exec(vmStat)?.[1]);
  if (pageSize === undefined || pages.includes(undefined)) throw new Error("vm_stat's output has no page counts");
  return Math.floor((pages.reduce((sum, count) => sum + Number(count), 0) * Number(pageSize)) / 1024 ** 2);
}

type Machine = { name: string; floorMiB: number; availableMiB: () => Promise<number> };

// Says why there's no room for another job, or null when every machine is above its floor. A floor
// of 0 skips that machine. A machine whose memory can't be read has no room, since a job couldn't
// start there either.
export async function checkMemoryFloor(machines: Machine[]) {
  const short: string[] = [];
  for (const { name, floorMiB, availableMiB } of machines) {
    if (floorMiB === 0) continue;
    try {
      const available = await availableMiB();
      if (available < floorMiB) short.push(`the ${name} has ${available} MiB available, below its ${floorMiB} MiB floor`);
    } catch (error) {
      short.push(`couldn't read the ${name}'s memory: ${error instanceof Error ? error.message : error}`);
    }
  }
  return short.length > 0 ? short.join("; ") : null;
}
