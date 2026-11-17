import type { MachineCause } from "./rules.ts";

// The one step that fixes each kind of machine trouble, on the machine that had it, in plain words.
export const fixFor = (kind: MachineCause["kind"], machine: string) => {
  switch (kind) {
    case "memory":
      return `Run fewer jobs at once on ${machine}, so each one has the memory it needs.`;
    case "connection":
      return `Restart Runnerbox on ${machine}.`;
    case "container":
      return `Ask the agent to find out why. It reads ${machine}'s logs, reports back here and changes nothing.`;
  }
};

// The most telling cause: memory first, since it's the most common and the others often follow from it.
export const mainCause = (causes: readonly MachineCause[]): MachineCause["kind"] =>
  (["memory", "connection", "container"] as const).find((kind) => causes.some((cause) => cause.kind === kind)) ?? "container";
