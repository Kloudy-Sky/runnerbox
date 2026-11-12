import * as Schema from "effect/Schema";

// The desktop app's own updates, as main reports them to the UI. `stable` reads the release feed,
// `nightly` the prerelease one.
export const UpdateChannel = Schema.Literals(["stable", "nightly"]);
export type UpdateChannel = typeof UpdateChannel.Type;

// `disabled`: this build never checks (from a checkout, or no feed). `ready`: an update is
// downloaded and installs on restart.
export const UpdateStatus = Schema.Literals(["disabled", "idle", "checking", "up-to-date", "downloading", "ready", "error"]);
export type UpdateStatus = typeof UpdateStatus.Type;

export const UpdateState = Schema.Struct({
  version: Schema.String,
  channel: UpdateChannel,
  status: UpdateStatus,
  // Why it's disabled, or what went wrong, in words for the owner.
  message: Schema.NullOr(Schema.String),
  // The version downloading or ready to install.
  pending: Schema.NullOr(Schema.String),
  // The newest version on the channel's feed at the last check, which can be older than this one.
  latest: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.String),
});
export type UpdateState = typeof UpdateState.Type;
