import {
  busyPercent,
  type CpuCounters,
  parseContainer,
  parseCpuCounters,
  parseLoad1,
  parseMeminfo,
} from "./machine-sample.ts";
import type { Machine, Sample } from "./sample-record.ts";

// One SSH call reads everything from the VM. `docker stats` covers every container in the VM, so
// another launcher's jobs show up too and the two can be compared. It has its own timeout, well
// inside readFromVm's, so a daemon slowed by swapping costs only the containers section.
export const VM_SAMPLE_COMMAND =
  "echo @@meminfo; cat /proc/meminfo; echo @@loadavg; cat /proc/loadavg; echo @@stat; head -1 /proc/stat; " +
  "if containers=$(timeout 10 docker stats --no-stream --format '{{json .}}' 2>/dev/null); then " +
  "echo @@containers; printf '%s\\n' \"$containers\"; fi; true";

export type MachineText = { meminfo: string; loadavg: string; stat: string };

type SamplerActions = {
  readHost: () => Promise<MachineText>;
  // VM_SAMPLE_COMMAND's output.
  readVm: () => Promise<string>;
  append: (sample: Sample) => Promise<void>;
  now: () => number;
};

export function splitSections(output: string) {
  const sections: Record<string, string> = {};
  for (const part of output.split(/^@@/m).slice(1)) {
    const newline = part.indexOf("\n");
    sections[newline === -1 ? part : part.slice(0, newline)] = newline === -1 ? "" : part.slice(newline + 1);
  }
  return sections;
}

// Takes one sample each time it's called. CPU is busy time since the previous call, so the first
// sample of each machine has none.
export function createSampler({ readHost, readVm, append, now }: SamplerActions) {
  const previous: { host?: CpuCounters; vm?: CpuCounters } = {};

  function machine(which: "host" | "vm", text: Partial<MachineText>): Machine | undefined {
    const memory = parseMeminfo(text.meminfo ?? "");
    const load1 = parseLoad1(text.loadavg ?? "");
    if (!memory || load1 === undefined) return;
    const counters = parseCpuCounters(text.stat ?? "");
    const busy = counters && busyPercent(previous[which], counters);
    if (counters) previous[which] = counters;
    return busy === undefined ? { ...memory, load1 } : { ...memory, load1, cpuBusyPercent: busy };
  }

  return async function sample() {
    const [hostText, vmOutput] = await Promise.all([readHost().catch(() => undefined), readVm().catch(() => undefined)]);
    const record: Sample = { time: new Date(now()).toISOString() };

    const host = hostText && machine("host", hostText);
    if (host) record.host = host;
    if (vmOutput !== undefined) {
      const sections = splitSections(vmOutput);
      const vm = machine("vm", sections);
      if (vm) record.vm = vm;
      if (sections.containers !== undefined) {
        record.containers = sections.containers.split("\n").flatMap((line) => parseContainer(line) ?? []);
      }
    }
    await append(record);
  };
}
