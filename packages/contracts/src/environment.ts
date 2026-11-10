import * as Schema from "effect/Schema";

// Bumped when a change to the RPC would break a client built against the old one.
export const PROTOCOL_VERSION = 1;

// What any caller can learn about an environment before pairing. A client checks the ID here
// before it sends a credential, so a saved address now answered by another machine gets none.
export const EnvironmentDescriptor = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  serverVersion: Schema.String,
  protocolVersion: Schema.Int,
});
export type EnvironmentDescriptor = typeof EnvironmentDescriptor.Type;

export const DESCRIPTOR_PATH = "/.well-known/runnerbox/environment";
