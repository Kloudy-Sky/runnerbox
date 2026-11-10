import * as Schema from "effect/Schema";
import { Step, Verdict } from "./history.ts";
import { LauncherEvent } from "./runners.ts";

export const InboxKind = Schema.Literals(["failure", "no_runner", "failing_slot", "slow_job"]);
export type InboxKind = typeof InboxKind.Type;
export const InboxGroup = Schema.Literals(["needs_you", "no_action"]);
export type InboxGroup = typeof InboxGroup.Type;

const NullableNumber = Schema.NullOr(Schema.Number);

export const Attempt = Schema.Struct({
  jobId: Schema.Number,
  attempt: Schema.Number,
  runner: Schema.NullOr(Schema.String),
  runnerType: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  durationMs: NullableNumber,
});

// What the machine looked like while the job ran. Bounds, since samples are a minute apart.
export const MachineEvidence = Schema.Struct({
  samples: Schema.Number,
  vmLowMiB: NullableNumber,
  vmTotalMiB: NullableNumber,
  hostLowMiB: NullableNumber,
  vmSwapPeakMiB: NullableNumber,
});

// Everything an item was decided from, so the user can check the rule's reading.
export const Evidence = Schema.Struct({
  steps: Schema.Array(Schema.Struct({ ...Step.fields, typicalMs: NullableNumber })),
  attempts: Schema.Array(Attempt),
  machine: Schema.NullOr(MachineEvidence),
  launcher: Schema.Array(LauncherEvent),
  durations: Schema.Array(Schema.Struct({ startedAt: Schema.String, ms: Schema.Number })),
  reasons: Schema.Array(Schema.String),
});
export type Evidence = typeof Evidence.Type;

export const InboxItem = Schema.Struct({
  id: Schema.String,
  kind: InboxKind,
  group: InboxGroup,
  verdict: Schema.NullOr(Verdict),
  repo: Schema.NullOr(Schema.String),
  install: Schema.NullOr(Schema.String),
  title: Schema.String,
  detail: Schema.String,
  at: Schema.String,
  evidence: Evidence,
});
export type InboxItem = typeof InboxItem.Type;
