import * as Schema from "effect/Schema";
import { Step, Verdict } from "./history.ts";
import { LauncherEvent } from "./runners.ts";

export const InboxKind = Schema.Literals(["failure", "no_runner", "failing_slot", "slow_job"]);
export type InboxKind = typeof InboxKind.Type;
export const InboxGroup = Schema.Literals(["needs_you", "quiet"]);
export type InboxGroup = typeof InboxGroup.Type;
// What doesn't need the owner, counted rather than listed: one-off failures, flaky jobs that
// aren't frequent, one slow run, failures in a job's own code, problems a later run fixed, and
// waits for runners that aren't this machine's.
export const QuietKind = Schema.Literals(["failed_once", "flaky", "slow", "own_code", "resolved", "other_runners"]);
export type QuietKind = typeof QuietKind.Type;

const NullableNumber = Schema.NullOr(Schema.Number);

export const Attempt = Schema.Struct({
  jobId: Schema.Number,
  attempt: Schema.Number,
  runId: Schema.Number,
  // Null for records synced before the commit was recorded; their attempts are grouped by run.
  headSha: Schema.NullOr(Schema.String),
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
  // When one item covers several repositories, labels or slots: each one's share.
  breakdown: Schema.Array(Schema.Struct({ label: Schema.String, count: Schema.Number, detail: Schema.String })),
});
export type Evidence = typeof Evidence.Type;

// A point in time, as an ISO string, that the server can compare with its clock.
export const Instant = Schema.String.check(Schema.makeFilter((value: string) => !Number.isNaN(Date.parse(value)), { expected: "a date and time" }));

// Where an item sits for the owner (see apps/server/src/inbox/itemState.ts). "back" is a snooze
// that ended, by its time or by a new failure, until the owner wakes or snoozes it again.
// "settled" is the owner's doing, or a later run that passed.
export const InboxItemStatus = Schema.Literals(["active", "snoozed", "back", "settled"]);
export type InboxItemStatus = typeof InboxItemStatus.Type;
export const InboxItemState = Schema.Struct({
  status: InboxItemStatus,
  snoozedUntil: Schema.NullOr(Instant),
  wokeAt: Schema.NullOr(Instant),
  // When the owner settled it. Null when a later run did, or it isn't settled.
  settledAt: Schema.NullOr(Instant),
});
export type InboxItemState = typeof InboxItemState.Type;

// Snoozing, settling or waking an item went wrong on the server. The path stays there.
export class InboxStateError extends Schema.TaggedError<InboxStateError>()("InboxStateError", { why: Schema.String }) {
  override get message() {
    return this.why;
  }
}
export const InboxItemId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));

// What an item that needs the owner costs them, most costly first: open pull requests a failing
// check blocks, jobs that wait longer, or nothing yet. `text` is the phrase the item leads with.
export const InboxCostLevel = Schema.Literals(["blocking", "slower", "nothing_yet"]);
export type InboxCostLevel = typeof InboxCostLevel.Type;
export const InboxCost = Schema.Struct({ level: InboxCostLevel, text: Schema.String });
export type InboxCost = typeof InboxCost.Type;

export const InboxItem = Schema.Struct({
  id: Schema.String,
  kind: InboxKind,
  group: InboxGroup,
  quiet: Schema.NullOr(QuietKind),
  verdict: Schema.NullOr(Verdict),
  repo: Schema.NullOr(Schema.String),
  install: Schema.NullOr(Schema.String),
  // What's wrong, naming the job and the machine, then what happened, why it's the owner's, and
  // the one step that fixes it, in words someone new to CI understands. Technical terms stay in
  // `evidence.reasons`. All written by rules over the logs, never by a model.
  title: Schema.String,
  happened: Schema.String,
  why: Schema.String,
  action: Schema.String,
  at: Schema.String,
  evidence: Evidence,
  // Older servers send items without it; read those as active.
  state: Schema.optionalKey(InboxItemState),
  // Only on items that need the owner. Older servers send none.
  cost: Schema.optionalKey(InboxCost),
  // The open proposal a rule wrote for this item, which the owner can approve from it.
  fix: Schema.optionalKey(Schema.Struct({ proposalId: Schema.String })),
});
export type InboxItem = typeof InboxItem.Type;

export const QuietGroup = Schema.Struct({ kind: QuietKind, title: Schema.String, items: Schema.Array(InboxItem) });
export type QuietGroup = typeof QuietGroup.Type;

// The home screen's headline, over the same window as the items.
export const InboxSummary = Schema.Struct({
  needYou: Schema.Number,
  jobs: Schema.Number,
  // Of the jobs that ran and finished passing or failing, the share that passed, 0 to 1.
  passRate: NullableNumber,
  // How long a typical job waited for a runner.
  typicalWaitMs: NullableNumber,
  ownMachinesMs: Schema.Number,
  githubMachinesMs: Schema.Number,
  // "2 things need you. The rest is fine." and the facts under it, as sentences.
  headline: Schema.String,
  facts: Schema.Array(Schema.String),
});
export type InboxSummary = typeof InboxSummary.Type;

export const Inbox = Schema.Struct({ summary: InboxSummary, items: Schema.Array(InboxItem), quiet: Schema.Array(QuietGroup) });
export type Inbox = typeof Inbox.Type;

// Snoozed and settled items are kept out of what needs the owner now.
export const isInboxItemHidden = (item: InboxItem) => item.state?.status === "snoozed" || item.state?.status === "settled";

// Every item, whether it needs the owner or sits in a quiet group.
export const inboxItems = (inbox: Inbox) => [...inbox.items, ...inbox.quiet.flatMap((group) => group.items)];
