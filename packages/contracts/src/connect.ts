import * as Schema from "effect/Schema";
import { EnvironmentDescriptor } from "./environment.ts";

// Runnerbox Connect: what the relay, an environment and a client send each other. The relay
// brokers identity and tunnels; it never holds an environment session and proxies no app traffic.

// The `typ` header of each signed message, so a token minted for one step can't stand in for another.
export const CONNECT_TYP = {
  linkProof: "rbx-env-link+jwt",
  unlinkProof: "rbx-env-unlink+jwt",
  mintRequest: "rbx-relay-mint+jwt",
  mintResponse: "rbx-env-mint+jwt",
  healthRequest: "rbx-relay-health+jwt",
  healthResponse: "rbx-env-health+jwt",
} as const;

// A DPoP proof of the client's key, sent when redeeming a Connect credential and with every
// request made on the session it buys.
export const DPOP_HEADER = "dpop";

export const environmentAudience = (environmentId: string) => `rbx-env:${environmentId}`;

const Registered = {
  iss: Schema.String,
  aud: Schema.String,
  sub: Schema.String,
  jti: Schema.String,
  iat: Schema.Number,
  exp: Schema.Number,
};

// Where the connector sends tunnel traffic. Only loopback is accepted, so a tunnel can't expose
// another service on the environment's network.
export const TunnelOrigin = Schema.Struct({ localHttpHost: Schema.String, localHttpPort: Schema.Int });
export type TunnelOrigin = typeof TunnelOrigin.Type;

// Signed by the environment's key: "link me to the user who holds this challenge".
export const LinkProofPayload = Schema.Struct({
  ...Registered,
  challenge: Schema.String,
  environmentId: Schema.String,
  environmentPublicKey: Schema.String,
  descriptor: EnvironmentDescriptor,
  origin: TunnelOrigin,
});
export type LinkProofPayload = typeof LinkProofPayload.Type;

export const UnlinkProofPayload = Schema.Struct({ ...Registered, environmentId: Schema.String });

// Signed by the relay: "mint a credential for this user, bound to this client key".
export const MintRequestPayload = Schema.Struct({
  ...Registered,
  environmentId: Schema.String,
  clientProofKeyThumbprint: Schema.String,
  cnf: Schema.Struct({ jkt: Schema.String }),
  nonce: Schema.String,
  scope: Schema.Array(Schema.Literal("environment:connect")),
});
export type MintRequestPayload = typeof MintRequestPayload.Type;

// Signed by the environment, binding its answer to the relay's nonce and the client's key.
export const MintResponsePayload = Schema.Struct({
  ...Registered,
  environmentId: Schema.String,
  clientProofKeyThumbprint: Schema.String,
  requestNonce: Schema.String,
  credential: Schema.String,
});
export const MintResponse = Schema.Struct({ credential: Schema.String, expiresAt: Schema.String, proof: Schema.String });
export type MintResponse = typeof MintResponse.Type;

export const HealthRequestPayload = Schema.Struct({
  ...Registered,
  environmentId: Schema.String,
  nonce: Schema.String,
  scope: Schema.Array(Schema.Literal("environment:status")),
});
export const HealthResponsePayload = Schema.Struct({
  ...Registered,
  environmentId: Schema.String,
  requestNonce: Schema.String,
  checkedAt: Schema.String,
});
export const HealthResponse = Schema.Struct({ checkedAt: Schema.String, descriptor: EnvironmentDescriptor, proof: Schema.String });
export type HealthResponse = typeof HealthResponse.Type;

// Signed request bodies sent to the environment's Connect endpoints.
export const SignedRequest = Schema.Struct({ proof: Schema.String });

// What a relay tells clients about how to sign in. Public values only.
export const RelayConfig = Schema.Struct({
  relayIssuer: Schema.String,
  clerkFrontendApi: Schema.String,
  cliClientId: Schema.String,
  desktopClientId: Schema.String,
});
export type RelayConfig = typeof RelayConfig.Type;

export const LinkChallengeResponse = Schema.Struct({ challenge: Schema.String, expiresAt: Schema.String });

export const LinkResponse = Schema.Struct({
  environmentId: Schema.String,
  cloudUserId: Schema.String,
  httpBaseUrl: Schema.String,
  // For `cloudflared` on the environment. Only the environment ever receives it.
  connectorToken: Schema.String,
  relayIssuer: Schema.String,
  relayPublicKey: Schema.String,
});
export type LinkResponse = typeof LinkResponse.Type;

export const LinkedEnvironment = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  linkedAt: Schema.String,
});
export type LinkedEnvironment = typeof LinkedEnvironment.Type;

export const ConnectRequest = Schema.Struct({ clientProofKeyThumbprint: Schema.String });
export const ConnectResponse = Schema.Struct({
  environmentId: Schema.String,
  httpBaseUrl: Schema.String,
  credential: Schema.String,
  expiresAt: Schema.String,
});
export type ConnectResponse = typeof ConnectResponse.Type;

export const StatusResponse = Schema.Struct({
  environmentId: Schema.String,
  status: Schema.Literals(["online", "offline"]),
  checkedAt: Schema.NullOr(Schema.String),
});
