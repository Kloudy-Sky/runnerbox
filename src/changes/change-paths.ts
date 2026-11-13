import type { VmInstall } from "../launcher/launcher-config.ts";
import { memoryMiB } from "../launcher/memory-size.ts";

// What a proposal may change, and how far. Only these paths exist: how many jobs a kind runs at
// once, how much memory each machine keeps free, and a kind's memory and CPU limits. Tokens, scope,
// workflows, images, env, the VM and the list of kinds are out of reach, whatever is asked.

// The machine `up` runs jobs on, measured by `up` itself, which bounds the values.
export type Machine = { readonly hostMiB: number; readonly vmMiB: number; readonly vmCpus: number };

export type Value = number | string;
export type Field = { readonly path: string; readonly value: Value; readonly min: number; readonly max: number; readonly unit: "slots" | "MiB" | "size" | "cpus" };

const SIZE = /^[0-9]+[bkmg]$/;
const KIND_FIELD = /^runners\.([a-z0-9]{1,20})\.(slots|memoryFloor\.(?:hostMiB|vmMiB)|limits\.(?:memory|memoryReservation|memorySwap|cpus))$/;
const INSTALL_FLOOR = /^memoryFloor\.(hostMiB|vmMiB)$/;
const MIN_MEMORY_MIB = 64;
const MIN_CPUS = 0.25;
const MAX_SLOTS = 64;

// Every allow-listed field the config has, with its bounds. A kind's own floor is only offered
// when it has one: adding one is a hand edit.
export function fieldsOf(config: VmInstall, machine: Machine): Field[] {
  const floor = (path: string, value: number, which: "hostMiB" | "vmMiB"): Field => ({ path, value, min: 0, max: which === "hostMiB" ? machine.hostMiB : machine.vmMiB, unit: "MiB" });
  return [
    floor("memoryFloor.hostMiB", config.memoryFloor.hostMiB, "hostMiB"),
    floor("memoryFloor.vmMiB", config.memoryFloor.vmMiB, "vmMiB"),
    ...config.runners.flatMap((runner) => {
      const at = `runners.${runner.name}`;
      return [
        // At most double, so one approval can't turn a kind up without limit.
        { path: `${at}.slots`, value: runner.slots, min: 1, max: Math.min(MAX_SLOTS, runner.slots * 2), unit: "slots" as const },
        ...(runner.memoryFloor ? [floor(`${at}.memoryFloor.hostMiB`, runner.memoryFloor.hostMiB, "hostMiB"), floor(`${at}.memoryFloor.vmMiB`, runner.memoryFloor.vmMiB, "vmMiB")] : []),
        { path: `${at}.limits.memory`, value: runner.limits.memory, min: MIN_MEMORY_MIB, max: machine.vmMiB, unit: "size" as const },
        { path: `${at}.limits.memoryReservation`, value: runner.limits.memoryReservation, min: MIN_MEMORY_MIB, max: machine.vmMiB, unit: "size" as const },
        { path: `${at}.limits.memorySwap`, value: runner.limits.memorySwap, min: MIN_MEMORY_MIB, max: machine.vmMiB * 2, unit: "size" as const },
        { path: `${at}.limits.cpus`, value: runner.limits.cpus, min: MIN_CPUS, max: machine.vmCpus, unit: "cpus" as const },
      ];
    }),
  ];
}

// Why `to` can't go in `field`, or null when it can.
export function refusal(field: Field, to: Value): string | null {
  if (field.unit === "size") {
    if (typeof to !== "string" || !SIZE.test(to)) return `${field.path} takes a size such as 3600m.`;
    const mib = memoryMiB(to);
    return mib < field.min || mib > field.max ? `${field.path} must be between ${field.min}m and ${field.max}m.` : null;
  }
  if (typeof to !== "number" || !Number.isFinite(to)) return `${field.path} takes a number.`;
  if (field.unit !== "cpus" && !Number.isInteger(to)) return `${field.path} takes a whole number.`;
  return to < field.min || to > field.max ? `${field.path} must be between ${field.min} and ${field.max}.` : null;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// The config file's JSON with one field set, and nothing else touched, so a default the owner never
// wrote doesn't appear in their file. The path was checked against the allow-list first.
export function withField(config: unknown, path: string, to: Value): unknown {
  const next = structuredClone(config);
  const fail = () => new Error(`${path} isn't a field a proposal can change.`);
  if (!isObject(next)) throw fail();
  const install = INSTALL_FLOOR.exec(path);
  const [, kind, field] = KIND_FIELD.exec(path) ?? [];
  const runner = Array.isArray(next.runners) ? next.runners.find((candidate: unknown) => isObject(candidate) && candidate.name === kind) : undefined;
  const [target, key] = install ? [next.memoryFloor, install[1]] : field?.includes(".") ? [isObject(runner) ? runner[field.split(".")[0]!] : undefined, field.split(".")[1]] : [runner, field];
  if (!isObject(target) || key === undefined) throw fail();
  target[key] = to;
  return next;
}
