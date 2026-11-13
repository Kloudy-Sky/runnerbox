import * as Schema from "effect/Schema";

// A change to one install's numbers that the agent proposed and only the owner can approve: a
// kind's slots, memory floors, and a kind's memory and CPU limits. `up` checks and applies it.

// The value a field held when proposed, and the one approved: a number, or a size such as 3600m.
export const ChangeValue = Schema.Union([Schema.Number, Schema.String.check(Schema.isPattern(/^[0-9]+[bkmg]$/))]);
export type ChangeValue = typeof ChangeValue.Type;

export const ProposedChange = Schema.Struct({ path: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9.]{1,80}$/)), from: ChangeValue, to: ChangeValue });
export type ProposedChange = typeof ProposedChange.Type;

// `open` until decided or 24 hours pass. Once approved, `up` reports `waiting` (for a moment with no
// job running), then `applied` or `not_applied`.
export const ProposalStatus = Schema.Literals(["open", "expired", "declined", "approved", "waiting", "applied", "not_applied"]);
export type ProposalStatus = typeof ProposalStatus.Type;

export const ApplyWhen = Schema.Literals(["idle", "now"]);
export type ApplyWhen = typeof ApplyWhen.Type;

export const Proposal = Schema.Struct({
  id: Schema.String,
  install: Schema.String,
  changes: Schema.Array(ProposedChange),
  // The agent's reason, shown as untrusted text.
  reason: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  // The run the evidence came from, where a rerun happens.
  runUrl: Schema.NullOr(Schema.String),
  // Set on a revert: the applied proposal it undoes.
  revertOf: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  // sha256 of exactly what's approved. Approving sends it back, so only the proposal shown applies.
  hash: Schema.String,
  status: ProposalStatus,
  decidedBy: Schema.NullOr(Schema.String),
  decidedAt: Schema.NullOr(Schema.String),
  when: Schema.NullOr(ApplyWhen),
  // Why it wasn't applied, in `up`'s words.
  outcome: Schema.NullOr(Schema.String),
});
export type Proposal = typeof Proposal.Type;

export const ProposalList = Schema.Struct({
  proposals: Schema.Array(Proposal),
  // Whether this session may approve, decline and revert.
  canApprove: Schema.Boolean,
});
export type ProposalList = typeof ProposalList.Type;

export class ProposalError extends Schema.TaggedError<ProposalError>()("ProposalError", { why: Schema.String }) {
  override get message() {
    return this.why;
  }
}
