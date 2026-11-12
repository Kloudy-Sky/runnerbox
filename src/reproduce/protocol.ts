import { type } from "arktype";
import { REPO_NAME } from "../github/github-client.ts";

// What `runnerbox serve` may ask of `up` over the reproduce socket, one JSON line per connection,
// answered with one JSON line.

export const MAX_COMMAND_LENGTH = 16_000;
export const MAX_COMMAND_SECONDS = 600;

const Id = "/^[0-9a-f]{8}$/";

export const ReproduceRequest = type({
  "+": "reject",
  op: "'start'",
  repo: type(REPO_NAME),
  commit: "/^[0-9a-f]{40}$/",
  kind: "/^[a-z0-9]{1,20}$/",
  // The tag the job ran on, when its runner event recorded one. The kind's current tag otherwise.
  "image?": "/^[a-z0-9][a-z0-9._\\/:@-]*$/",
  // `setup` keeps the network for the first command only, which installs dependencies, then cuts it.
  network: "'on' | 'setup'",
})
  .or({ "+": "reject", op: "'exec'", id: Id, command: `1 <= string <= ${MAX_COMMAND_LENGTH}`, timeoutSec: `1 <= number.integer <= ${MAX_COMMAND_SECONDS}` })
  .or({ "+": "reject", op: "'stop'", id: Id });

export type ReproduceRequest = typeof ReproduceRequest.infer;

export type Started = { id: string; image: string; imageFallback: boolean };
export type Executed = { exitCode: number | null; output: string; truncated: boolean; timedOut: boolean; commandsLeft: number };
export type Stopped = { stopped: true };
export type ReproduceResponse = ({ ok: true } & (Started | Executed | Stopped)) | { ok: false; error: string };
