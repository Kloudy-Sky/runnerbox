import { type } from "arktype";
import type { Field, Value } from "../changes/change-paths.ts";
import { ReproduceRequest, type ReproduceResponse } from "../reproduce/protocol.ts";

// What `runnerbox serve` may ask of `up` over the control socket, one JSON line per connection,
// answered with one JSON line: reproduce's requests, and reading and applying a proposed change.

export const MAX_CHANGES = 20;

const Change = type({
  "+": "reject",
  path: "/^[A-Za-z0-9.]{1,80}$/",
  // The value the owner saw, which must still be the config's, and the one they approved.
  from: type("number").or("/^[0-9]+[bkmg]$/"),
  to: type("number").or("/^[0-9]+[bkmg]$/"),
});
export type Change = typeof Change.infer;

export const ApplyRequest = type({
  "+": "reject",
  op: "'apply'",
  proposalId: "/^[0-9a-f]{16}$/",
  // The server's hash of exactly what the owner approved, kept in the change log.
  hash: "/^[0-9a-f]{64}$/",
  approvedBy: { "+": "reject", session: "/^[\\w-]{1,64}$/", label: "1 <= string <= 80" },
  // `idle` waits, up to 6 hours, for a moment with no job running; `now` drains at once.
  when: "'idle' | 'now'",
  changes: Change.array().atLeastLength(1).atMostLength(MAX_CHANGES),
});
export type ApplyRequest = typeof ApplyRequest.infer;

// The owner asking, from the app, for this install's runners to restart at the first moment no job
// is running, so they pick up a new runnerbox.js. Like an idle change, it waits up to 6 hours.
export const RestartRequest = type({
  "+": "reject",
  op: "'restart'",
  requestedBy: { "+": "reject", session: "/^[\\w-]{1,64}$/", label: "1 <= string <= 80" },
});
export type RestartRequest = typeof RestartRequest.infer;

export const ControlRequest = ReproduceRequest.or({ "+": "reject", op: "'describe'" })
  .or(ApplyRequest)
  .or(RestartRequest)
  .or({ "+": "reject", op: "'restart-status'" });
export type ControlRequest = typeof ControlRequest.infer;

export type Pending = { proposalId: string; when: "idle" | "now"; since: string };
export type Described = { install: string; fields: Field[]; pending: Pending | null };
export type Accepted = { accepted: true; when: "idle" | "now" };
// What `up` says to a restart on an install whose config has no `"changes": true`, the owner's
// switch for letting the app act on the runner side. The app shows it beside the command.
export const RESTARTS_OFF = "To restart these from here, turn on changes in this machine's Runnerbox config.";

// A restart waiting for no job to be running, or null.
export type RestartWaiting = { restart: { since: string; requestedBy: string } | null };
export type ControlResponse = ReproduceResponse | ({ ok: true } & (Described | Accepted | RestartWaiting));

export type { Value };
