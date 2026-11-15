import * as Schema from "effect/Schema";
import { ContainerLimits } from "./resources.ts";

const NullableNumber = Schema.NullOr(Schema.Number);

// What the minutes would have cost on GitHub's hosted runners of the nearest size, at prices read
// from GitHub's pricing page on `pricesReadOn`. An estimate, never what the owner's machine costs.
export const CostEstimate = Schema.Struct({
  usd: Schema.Number,
  minutes: Schema.Number,
  // The hosted size the minutes were priced at, in plain words: "4-core Linux".
  size: Schema.String,
  usdPerMinute: Schema.Number,
});
export type CostEstimate = typeof CostEstimate.Type;

// Why a kind's jobs waited, when the evidence names one: the same rule as the inbox's wait reason.
export const Bottleneck = Schema.Struct({ cause: Schema.Literals(["slots", "memory"]), text: Schema.String });
export type Bottleneck = typeof Bottleneck.Type;

export const KindUsage = Schema.Struct({
  install: Schema.String,
  kind: Schema.String,
  label: Schema.String,
  // Null when neither the live state nor the logs say.
  slots: NullableNumber,
  limits: Schema.NullOr(ContainerLimits),
  jobs: Schema.Number,
  // Time jobs ran on this kind, not time runners waited for one.
  runnerMs: Schema.Number,
  // Shares of the window: all slots running jobs at once, and at least one.
  allBusyShare: NullableNumber,
  anyBusyShare: Schema.Number,
  // How long jobs waited for a runner, including those that never got one.
  waitTypicalMs: NullableNumber,
  waitLongestMs: NullableNumber,
  bottleneck: Schema.NullOr(Bottleneck),
  cost: Schema.NullOr(CostEstimate),
});
export type KindUsage = typeof KindUsage.Type;

// Whether one install's machine had room over the window, in one sentence by rules. `floorMiB` is
// the VM memory Runnerbox keeps free, or null when the machine's records don't say.
export const MachineFit = Schema.Struct({
  install: Schema.String,
  floorMiB: NullableNumber,
  lowestMiB: NullableNumber,
  totalMiB: NullableNumber,
  sentence: Schema.String,
});
export type MachineFit = typeof MachineFit.Type;

export const KindUsageReport = Schema.Struct({
  since: Schema.String,
  until: Schema.String,
  kinds: Schema.Array(KindUsage),
  // Every kind's estimate added up, or null when none could be priced.
  totalCost: Schema.NullOr(Schema.Struct({ usd: Schema.Number, minutes: Schema.Number })),
  pricesReadOn: Schema.String,
  pricesSource: Schema.String,
  // Missing from an older server.
  machines: Schema.optionalKey(Schema.Array(MachineFit)),
});
export type KindUsageReport = typeof KindUsageReport.Type;

// One job's typical time per day, and whether it has become slower than it was before the window.
export const JobTrend = Schema.Struct({
  workflow: Schema.NullOr(Schema.String),
  job: Schema.String,
  runnerType: Schema.String,
  // On GitHub's machines: its labels didn't ask for a self-hosted runner. Missing from an older server.
  hosted: Schema.optionalKey(Schema.Boolean),
  runs: Schema.Number,
  runnerMs: Schema.Number,
  typicalMs: NullableNumber,
  // The typical time over the same length of time just before the window.
  earlierTypicalMs: NullableNumber,
  slower: Schema.Boolean,
  // For a job that became slower, the step that grew most and a sentence saying so. Missing from an
  // older server.
  change: Schema.optionalKey(Schema.NullOr(Schema.Struct({ step: Schema.String, earlierMs: Schema.Number, nowMs: Schema.Number, text: Schema.String }))),
  days: Schema.Array(Schema.Struct({ day: Schema.String, runs: Schema.Number, typicalMs: NullableNumber })),
});
export type JobTrend = typeof JobTrend.Type;
