import * as Schema from "effect/Schema";

const Base = {
  install: Schema.String,
  startedAt: Schema.String,
  durationMs: Schema.Number,
  runnerType: Schema.optionalKey(Schema.String),
};

// What `up` recorded, tagged with the install that wrote it. See docs/analytics.md.
export const LauncherEvent = Schema.Union([
  Schema.Struct({
    ...Base,
    event: Schema.Literal("runner"),
    slot: Schema.Number,
    runner: Schema.String,
    exitCode: Schema.NullOr(Schema.Number),
    released: Schema.Union([Schema.Literal(false), Schema.Literals(["memory", "image"])]),
    // The image tag the runner's container ran on, when `up` recorded it.
    image: Schema.optionalKey(Schema.String),
    // The kind's container limits when it ran, when `up` recorded them.
    limits: Schema.optionalKey(Schema.Struct({ memoryMiB: Schema.Number, cpus: Schema.Number })),
  }),
  Schema.Struct({ ...Base, event: Schema.Literal("memory_wait"), slot: Schema.Number }),
  Schema.Struct({ ...Base, event: Schema.Literal("image_build"), tag: Schema.String, ok: Schema.Boolean }),
]);
export type LauncherEvent = typeof LauncherEvent.Type;

export const Machine = Schema.Struct({
  totalMiB: Schema.Number,
  availableMiB: Schema.Number,
  swapUsedMiB: Schema.Number,
  load1: Schema.Number,
  cpuBusyPercent: Schema.optionalKey(Schema.Number),
});

export const MachineSample = Schema.Struct({
  install: Schema.String,
  time: Schema.String,
  host: Schema.optionalKey(Machine),
  vm: Schema.optionalKey(Machine),
  containers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, cpuPercent: Schema.Number, memMiB: Schema.Number })),
  ),
});
export type MachineSample = typeof MachineSample.Type;

// What a slot is doing now. `registered` means a runner is online: waiting for a job, or running
// one, which `up` can't tell apart until it tries to remove the runner. `busy` is when it tried.
export const SlotPhase = Schema.Literals(["waiting", "minting", "registered", "busy", "backoff", "stopped"]);
export type SlotPhase = typeof SlotPhase.Type;

export const SlotState = Schema.Struct({
  slot: Schema.Number,
  phase: SlotPhase,
  since: Schema.String,
  runner: Schema.NullOr(Schema.String),
  // Why it's waiting or backing off, in `up`'s own words.
  detail: Schema.NullOr(Schema.String),
  // The job its runner said it took, while busy. Missing from an older `up`.
  job: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

// A tool found in the image and its version, or null when the image doesn't have it. The first is
// the image's OS, named as the image names it.
// For a few tools, the server adds when this version was released and the newest one, from GitHub,
// once someone has watched the queue.
export const ImageTool = Schema.Struct({
  name: Schema.String,
  version: Schema.NullOr(Schema.String),
  releasedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  newest: Schema.optionalKey(Schema.NullOr(Schema.Struct({ version: Schema.String, releasedAt: Schema.String }))),
});
export type ImageTool = typeof ImageTool.Type;

export const KindState = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  image: Schema.NullOr(Schema.String),
  building: Schema.NullOr(Schema.String),
  // Missing from an older `up`. `builtAt` and `tools` are null until the current image is probed.
  buildingSince: Schema.optionalKey(Schema.NullOr(Schema.String)),
  buildFailedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rebuildDays: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  builtAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tools: Schema.optionalKey(Schema.NullOr(Schema.Array(ImageTool))),
  // Where its jobs run. Only `container` jobs are sampled. Missing from an older `up`.
  runsIn: Schema.optionalKey(Schema.Literals(["container", "job_vm", "host"])),
  slots: Schema.Array(SlotState),
});

// One install's live state, from the file `up` keeps in its state directory. `stale` means `up`
// stopped updating it: it exited without saying so, or it's stuck.
export const InstallState = Schema.Struct({
  install: Schema.String,
  pid: Schema.Number,
  startedAt: Schema.String,
  updatedAt: Schema.String,
  stopping: Schema.Boolean,
  stale: Schema.Boolean,
  kinds: Schema.Array(KindState),
});
export type InstallState = typeof InstallState.Type;
