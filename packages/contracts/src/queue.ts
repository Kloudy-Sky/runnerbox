import * as Schema from "effect/Schema";

// A job GitHub has queued for one of this machine's runner labels. The names are the repo's own
// text, so clients show them as plain text, and the URL only when it's a github.com page.
export const WaitingJob = Schema.Struct({
  repo: Schema.String,
  workflow: Schema.NullOr(Schema.String),
  job: Schema.String,
  label: Schema.String,
  since: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type WaitingJob = typeof WaitingJob.Type;

// What the queue poll knows. `off` hides it: no usable report.env, so no GitHub calls are made.
// `slowed` and `paused` say the token's budget is getting short, and `reason` says why in words.
export const QueueStatus = Schema.Literals(["off", "watching", "slowed", "paused"]);
export type QueueStatus = typeof QueueStatus.Type;

export const QueueView = Schema.Struct({
  status: QueueStatus,
  reason: Schema.NullOr(Schema.String),
  waiting: Schema.Array(WaitingJob),
  // When checking starts again, while paused.
  resumesAt: Schema.NullOr(Schema.String),
  // Repos with job history beyond the ones polled, which are the most recently active, and queued
  // runs beyond the ones looked inside, the longest waiting. Their jobs may be missing.
  reposLeftOut: Schema.Number,
  runsLeftOut: Schema.Number,
  checkedAt: Schema.NullOr(Schema.String),
});
export type QueueView = typeof QueueView.Type;
