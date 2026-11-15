import * as Schema from "effect/Schema";

// Moving a server to a newer release of its own repository, from the app. The app names only the
// version; the server builds the download's address itself, from the repository built into it.

// An exact release version, such as 0.3.2 or 0.3.2-nightly.20261114.41. The same rule as
// apps/server/src/update/supervisor/version.ts, which can't import this file.
export const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
export const ReleaseVersion = Schema.String.check(Schema.isMaxLength(256), Schema.isPattern(RELEASE_VERSION));

// Why a server can't update now. `checkout`: built from a checkout, so it knows no releases.
// `unsupervised`: started some way other than `runnerbox serve`. `not-writable`: it can't replace
// its own runnerbox.js. The rest are work a restart would cut short, or an update already going.
export const UpdateBlocker = Schema.Literals(["checkout", "unsupervised", "not-writable", "updating", "turn-running", "monitor-running", "reproduce-running"]);
export type UpdateBlocker = typeof UpdateBlocker.Type;

// How the last update went. `pending` only while it's still going, which a client can see if it
// reconnects to the new version in the moment before it's put in place.
export const UpdateOutcome = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  status: Schema.Literals(["pending", "committed", "rolled-back"]),
  // Why it was rolled back, in a sentence.
  reason: Schema.optionalKey(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.optionalKey(Schema.String),
});
export type UpdateOutcome = typeof UpdateOutcome.Type;

export const UpdateStatus = Schema.Struct({
  serverVersion: Schema.String,
  // Null when an update can start now.
  blocker: Schema.NullOr(UpdateBlocker),
  lastUpdate: Schema.NullOr(UpdateOutcome),
});
export type UpdateStatus = typeof UpdateStatus.Type;

// Each step of `server.update`, in order. After `Starting` the server stops, so the stream and its
// socket end; the client reconnects and reads `lastUpdate` for the update with that ID.
export const UpdateProgress = Schema.Union([
  Schema.TaggedStruct("Downloading", { received: Schema.Int, total: Schema.NullOr(Schema.Int) }),
  // The checksum, then whether the new version runs on this machine.
  Schema.TaggedStruct("Checking", {}),
  Schema.TaggedStruct("Starting", { updateId: Schema.String }),
]);
export type UpdateProgress = typeof UpdateProgress.Type;

// An update that didn't start, with the old version still serving. `detail` is the sentence to
// show; `reason` is for the app to pick what to offer next.
export class ServerUpdateError extends Schema.TaggedError<ServerUpdateError>()("ServerUpdateError", {
  reason: Schema.Union([UpdateBlocker, Schema.Literals(["not-newer", "download-failed", "checksum-mismatch", "disk-full", "refused", "unsigned", "bad-signature"])]),
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}

// Whether a release can be installed from the app, asked before offering Update. `not-required`:
// this server trusts no signing key yet. `missing`: it does, and the release has no signature, as
// a release made by pushing a tag. `invalid`: its signature isn't by a key the server trusts.
export const ReleaseCheck = Schema.Struct({ signature: Schema.Literals(["not-required", "valid", "missing", "invalid"]) });
export type ReleaseCheck = typeof ReleaseCheck.Type;
