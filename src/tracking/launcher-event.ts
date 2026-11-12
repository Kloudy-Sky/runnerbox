import { type } from "arktype";

const Base = { startedAt: "string", durationMs: "number" } as const;

// What `up` records about its own work, one line per finished thing. Times are ISO strings. Events
// from a runner kind also carry `runnerType`, its name. See docs/analytics.md.
export const LauncherEventRecord = type({
  ...Base,
  event: "'runner'",
  slot: "number",
  runner: "string",
  exitCode: "number | null",
  // Why the slot removed this runner unused, if it did, so its time was waiting, not work.
  released: "false | 'memory' | 'image'",
  "runnerType?": "string",
  // The image tag the runner's container ran, so a reproduce can use the same one. Older lines
  // don't have it.
  "image?": "string",
})
  .or({ ...Base, event: "'memory_wait'", slot: "number", "runnerType?": "string" })
  .or({ ...Base, event: "'image_build'", tag: "string", ok: "boolean", "runnerType?": "string" });

export type LauncherEvent = typeof LauncherEventRecord.infer;
