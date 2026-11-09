import { type } from "arktype";

// Parsers for what the sampler reads from Linux and Docker. Each returns undefined for input it
// can't read, so one bad section leaves the rest of a sample intact.

export type CpuCounters = { busy: number; total: number };

export type Machine = {
  totalMiB: number;
  // The kernel's estimate of memory a new process could use without swapping.
  availableMiB: number;
  swapUsedMiB: number;
  load1: number;
  // Over the time since the previous sample. Absent on a sampler's first sample.
  cpuBusyPercent?: number;
};

export type Container = { name: string; cpuPercent: number; memMiB: number };

export function parseMeminfo(text: string) {
  const kib = (field: string) => {
    const value = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(text)?.[1];
    return value === undefined ? undefined : Number(value) / 1024;
  };
  const [total, available, swapTotal, swapFree] = ["MemTotal", "MemAvailable", "SwapTotal", "SwapFree"].map(kib);
  if (total === undefined || available === undefined || swapTotal === undefined || swapFree === undefined) return;
  return { totalMiB: Math.round(total), availableMiB: Math.round(available), swapUsedMiB: Math.round(swapTotal - swapFree) };
}

export function parseLoad1(loadavg: string) {
  const load = Number(loadavg.split(" ")[0]);
  return Number.isFinite(load) ? load : undefined;
}

// The first line of /proc/stat: user nice system idle iowait irq softirq steal, then guest and
// guest_nice, which the kernel already counts inside user and nice, so only the first 8 are summed.
// Busy leaves out idle, iowait and steal, the last being time the hypervisor gave to someone else.
export function parseCpuCounters(statLine: string): CpuCounters | undefined {
  const fields = statLine.trim().split(/\s+/);
  if (fields[0] !== "cpu") return;
  const values = fields.slice(1, 9).map(Number);
  if (values.length < 5 || values.some((value) => !Number.isFinite(value))) return;
  const total = values.reduce((sum, value) => sum + value, 0);
  const [idle = 0, iowait = 0, , , steal = 0] = values.slice(3);
  return { busy: total - idle - iowait - steal, total };
}

export function busyPercent(previous: CpuCounters | undefined, current: CpuCounters) {
  if (!previous || current.total <= previous.total) return;
  return Math.round(((current.busy - previous.busy) / (current.total - previous.total)) * 1000) / 10;
}

const UNITS: Record<string, number> = {
  B: 1 / 1048576, kB: 1000 / 1048576, KiB: 1 / 1024, MB: 1e6 / 1048576, MiB: 1, GB: 1e9 / 1048576, GiB: 1024,
};

// One line of `docker stats --format '{{json .}}'`, such as
// {"Name":"x-slot1","CPUPerc":"12.5%","MemUsage":"1.2GiB / 3.5GiB",...}.
const DockerStats = type({ Name: "string", CPUPerc: "string", MemUsage: "string" });

export function parseContainer(line: string): Container | undefined {
  try {
    const stats = DockerStats(JSON.parse(line));
    if (stats instanceof type.errors) return;
    const { Name, CPUPerc, MemUsage } = stats;
    const used = /^([\d.]+)\s*([A-Za-z]+)\s*\//.exec(MemUsage);
    const unit = used?.[2] === undefined ? undefined : UNITS[used[2]];
    const cpu = Number.parseFloat(CPUPerc);
    if (!used || unit === undefined || !Number.isFinite(cpu)) return;
    return { name: Name, cpuPercent: cpu, memMiB: Math.round(Number(used[1]) * unit) };
  } catch {
    return;
  }
}
