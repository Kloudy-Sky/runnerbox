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

// Memory as the owner reads it, rounded the way the app shows it: GB above 1024 MiB, else MB.
const memoryWords = (mib: number) => (mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${Math.round(mib)} MB`);

// Says why there's no room for what's `starting`, in sentences for the owner, or null when every
// machine is above its floor. A floor of 0 skips that machine. A machine whose memory can't be read
// has no room, since nothing could start there either. Records keep the numbers in MiB.
export async function checkMemoryFloor(machines: Machine[], starting = "another runner") {
  const short: string[] = [];
  for (const { name, floorMiB, availableMiB } of machines) {
    if (floorMiB === 0) continue;
    try {
      const available = await availableMiB();
      if (available < floorMiB) {
        // Rounded alike, the two could read the same; then both go in whole MB, so the reason never contradicts itself.
        const [free, kept] = memoryWords(available) === memoryWords(floorMiB) ? [`${Math.floor(available)} MB`, `${floorMiB} MB`] : [memoryWords(available), memoryWords(floorMiB)];
        short.push(`The ${name} has ${free} free. Runnerbox keeps ${kept} free before it starts ${starting}.`);
      }
    } catch (error) {
      short.push(`Runnerbox couldn't read the ${name}'s memory: ${error instanceof Error ? error.message : error}.`);
    }
  }
  return short.length > 0 ? short.join(" ") : null;
}
