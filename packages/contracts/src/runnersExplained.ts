import * as Schema from "effect/Schema";
import { SlotPhase } from "./runners.ts";

// The Runners page, put in plain words by rules on the server. Every sentence here is written from
// the machine's own records, the same every time, with no model. Job names in it come from job
// output, so they're untrusted text: show them as plain text, never as Markdown.

// What one runner is doing now, for the rules. `maybe_running` is an older `up`, which can't tell
// a ready runner from one on a job.
export const RunnerTileState = Schema.Literals(["running", "ready", "maybe_running", "stepped_aside", "starting", "retrying", "stopped"]);
export type RunnerTileState = typeof RunnerTileState.Type;

// A runner as its tile shows it. The page words `phase` and `job` the way the Now view does;
// `phase` is `minting` for the moment `up` waits between one runner and the next. `why` is the
// machine's reason for waiting, in plain words, when it gives one.
export const RunnerTile = Schema.Struct({
  kind: Schema.String,
  slot: Schema.Number,
  state: RunnerTileState,
  phase: SlotPhase,
  job: Schema.NullOr(Schema.String),
  why: Schema.NullOr(Schema.String),
  since: Schema.String,
});
export type RunnerTile = typeof RunnerTile.Type;

// The machine's memory now. `jobs` are the running jobs measured one by one; when they aren't,
// `unmeasured` says why in words. `floorMiB` is what Runnerbox keeps free, or null when the records
// don't say.
export const MemoryReading = Schema.TaggedStruct("reading", {
  machine: Schema.Literals(["VM", "host"]),
  at: Schema.String,
  totalMiB: Schema.Number,
  availableMiB: Schema.Number,
  floorMiB: Schema.NullOr(Schema.Number),
  jobs: Schema.Array(Schema.Struct({ kind: Schema.String, slot: Schema.Number, job: Schema.NullOr(Schema.String), memMiB: Schema.Number })),
  unmeasured: Schema.NullOr(Schema.String),
});
export const NoMemoryReading = Schema.TaggedStruct("none", { why: Schema.String });
export const MemoryPicture = Schema.Union([MemoryReading, NoMemoryReading]);
export type MemoryPicture = typeof MemoryPicture.Type;

export const LaneState = Schema.Literals(["job", "stepped_aside", "ready"]);
export type LaneState = typeof LaneState.Type;
// One runner's last hour as spans. Time the records can't place is left out.
export const RunnerLane = Schema.Struct({
  kind: Schema.String,
  slot: Schema.Number,
  spans: Schema.Array(Schema.Struct({ state: LaneState, start: Schema.String, end: Schema.String, job: Schema.NullOr(Schema.String) })),
});
export type RunnerLane = typeof RunnerLane.Type;

export const KindStory = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  sentence: Schema.String,
  // The kind's container limits on its newest runner, when `up` recorded them.
  limits: Schema.NullOr(Schema.Struct({ memoryMiB: Schema.Number, cpus: Schema.Number })),
});
export type KindStory = typeof KindStory.Type;

// One record under an episode, with the raw facts the sentence leaves out.
export const EpisodeRow = Schema.Struct({
  at: Schema.String,
  kind: Schema.NullOr(Schema.String),
  slot: Schema.NullOr(Schema.Number),
  what: Schema.String,
  runner: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
});
export type EpisodeRow = typeof EpisodeRow.Type;

export const EpisodeKind = Schema.Literals(["stepped_aside", "jobs", "failing", "new_image", "build"]);
export type EpisodeKind = typeof EpisodeKind.Type;

// Records that belong together, such as eleven runners stepping aside in twenty minutes, as one
// sentence. `rows` holds the first of them, and `more` counts the rest.
export const Episode = Schema.Struct({
  id: Schema.String,
  kind: EpisodeKind,
  startedAt: Schema.String,
  endedAt: Schema.String,
  sentence: Schema.String,
  bad: Schema.Boolean,
  rows: Schema.Array(EpisodeRow),
  more: Schema.Number,
});
export type Episode = typeof Episode.Type;

export const InstallExplained = Schema.Struct({
  install: Schema.String,
  stale: Schema.Boolean,
  headline: Schema.String,
  memory: MemoryPicture,
  runners: Schema.Array(RunnerTile),
  lanes: Schema.Array(RunnerLane),
  kinds: Schema.Array(KindStory),
  episodes: Schema.Array(Episode),
});
export type InstallExplained = typeof InstallExplained.Type;

// `at` is the moment it was written, which every age and the lanes' hour are measured from.
export const RunnersExplained = Schema.Struct({ at: Schema.String, installs: Schema.Array(InstallExplained) });
export type RunnersExplained = typeof RunnersExplained.Type;

// What "Ask the agent to explain" asks, the same every time.
export const RUNNERS_QUESTION = "In plain words, what are this machine's runners doing, and is anything wrong? Say what the records show and what they can't tell.";
