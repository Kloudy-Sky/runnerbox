import type { MachineCause } from "./rules.ts";

// What the owner can do about each kind of machine trouble. One sentence each, plain words.
export const ADVICE = {
  memory: "Give the VM more memory, or run fewer jobs at once by lowering this kind's slots or raising its memory floor.",
  connection: "Check that the VM is running and that the host can reach it over SSH.",
  container: "Look in up's log for why the container stopped, and run the kind's image by hand in the VM to see the error.",
} as const;

// The advice for the most telling cause: memory first, since it's the most common and the others
// often follow from it.
export const adviceFor = (causes: readonly MachineCause[]) =>
  ADVICE[(["memory", "connection", "container"] as const).find((kind) => causes.some((cause) => cause.kind === kind)) ?? "container"];
