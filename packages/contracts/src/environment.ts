import * as Schema from "effect/Schema";

// Bumped when a change to the RPC would break a client built against the old one.
export const PROTOCOL_VERSION = 1;

// What any caller can learn about an environment before pairing. The ID and key are public, so
// matching them proves nothing on its own. Asked with `?nonce=`, the server adds `proof`: its
// signature over that nonce. A client sends a credential only after that signature checks out
// against the key it pinned at pairing, so a reused address answered by another machine gets none.
// The key and proof are optional so clients from before them still decode the descriptor.
export const EnvironmentDescriptor = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  serverVersion: Schema.String,
  protocolVersion: Schema.Int,
  // The environment's Ed25519 key, as SPKI PEM: the same key it links to a Connect relay with.
  publicKey: Schema.optional(Schema.String),
  // Base64url Ed25519 signature over `serverProofMessage(environmentId, nonce)`.
  proof: Schema.optional(Schema.String),
});
export type EnvironmentDescriptor = typeof EnvironmentDescriptor.Type;

export const DESCRIPTOR_PATH = "/.well-known/runnerbox/environment";

// A client's nonce: 16 to 64 base64url characters, so it's fresh without being a payload.
export const SERVER_PROOF_NONCE = /^[A-Za-z0-9_-]{16,64}$/;

// What the server signs to prove it holds the environment's key. The prefix keeps this signature
// from being taken for any other the same key makes.
export const serverProofMessage = (environmentId: string, nonce: string) => `runnerbox-server-proof:v1\n${environmentId}\n${nonce}`;
