import { type } from "arktype";
import { LAST_LINE_MAX } from "../launcher/last-line.ts";

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
  // The kind's container limits when this runner ran, since an approved change can alter them
  // later. Host kinds have none, and older lines don't have it.
  "limits?": { memoryMiB: "number", cpus: "number" },
  // The last line the runner printed to stderr, when it failed within a minute. It's runner
  // output, shown as untrusted text. Older lines don't have it.
  "lastLine?": type.string.atMostLength(LAST_LINE_MAX),
})
  .or({ ...Base, event: "'memory_wait'", slot: "number", "runnerType?": "string" })
  .or({ ...Base, event: "'image_build'", tag: "string", ok: "boolean", "runnerType?": "string" });

export type LauncherEvent = typeof LauncherEventRecord.infer;
