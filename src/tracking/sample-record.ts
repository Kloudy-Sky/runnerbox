import { type } from "arktype";

// One machine in a sample. See docs/analytics.md for what each field measures.
export const MachineRecord = type({
  totalMiB: "number",
  availableMiB: "number",
  swapUsedMiB: "number",
  load1: "number",
  "cpuBusyPercent?": "number",
});

export const ContainerRecord = type({ name: "string", cpuPercent: "number", memMiB: "number" });

// One line of samples.ndjson. A machine that couldn't be read is absent, never zeros, and
// `containers` is absent when Docker didn't answer.
export const SampleRecord = type({
  time: "string",
  "host?": MachineRecord,
  "vm?": MachineRecord,
  "containers?": ContainerRecord.array(),
});

export type Machine = typeof MachineRecord.infer;
export type Container = typeof ContainerRecord.infer;
export type Sample = typeof SampleRecord.infer;
