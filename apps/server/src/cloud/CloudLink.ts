import { join } from "node:path";
import { boundedLifetime, signJwt, verifyJwt } from "@runnerbox/connect/jwt";
import { relayClient } from "@runnerbox/connect/relay";
import { CONNECT_TYP, environmentAudience, HealthRequestPayload, MCP_SCOPES, MintRequestPayload } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as AuthStore from "../auth/AuthStore.ts";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as EnvironmentIdentity from "../environment/EnvironmentIdentity.ts";

// This environment's link to a Runnerbox Connect relay. The environment holds its own signing
// key; the relay knows only the public half. The relay may ask for a credential for the linked
// user, and the environment checks every such request before minting a one-time code that only
// the requesting client's key can redeem, and that buys reading, nothing more.

export class CloudLinkError extends Schema.TaggedError<CloudLinkError>()("CloudLinkError", {
  operation: Schema.Literals(["read", "write", "key", "relay"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return this.operation === "relay"
      ? `The relay refused: ${this.cause instanceof Error ? this.cause.message : "unknown error"}`
      : `Couldn't ${this.operation === "key" ? "load this environment's key" : `${this.operation} the Connect link`}.`;
  }
}

export class NotLinked extends Schema.TaggedError<NotLinked>()("NotLinked", {}) {
  override get message() {
    return "This environment isn't linked to Runnerbox Connect.";
  }
}

export class ConnectProofRejected extends Schema.TaggedError<ConnectProofRejected>()("ConnectProofRejected", {
  request: Schema.Literals(["mint", "health"]),
}) {}

export class ConnectProofReplayed extends Schema.TaggedError<ConnectProofReplayed>()("ConnectProofReplayed", {
  request: Schema.Literals(["mint", "health"]),
}) {}

export const LinkState = Schema.Struct({
  relayUrl: Schema.String,
  relayIssuer: Schema.String,
  relayPublicKey: Schema.String,
  cloudUserId: Schema.String,
  httpBaseUrl: Schema.String,
  // Optional so links made before recovery existed still read; they register once they have it.
  tunnelId: Schema.optionalKey(Schema.String),
  connectorToken: Schema.String,
  // The loopback port `cloudflared` sends tunnel traffic to: a listener of its own that serves
  // only Connect, separate from the one apps and agents use on this machine.
  tunnelPort: Schema.Int,
  linkedAt: Schema.String,
});
export type LinkState = typeof LinkState.Type;
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(LinkState));
const decodeMintRequest = Schema.decodeUnknownEffect(MintRequestPayload);
const decodeHealthRequest = Schema.decodeUnknownEffect(HealthRequestPayload);

// A Connect credential must be redeemed at once; the client is waiting on the relay's answer.
const CREDENTIAL_TTL_MS = 2 * 60_000;
const LINK_PROOF_SECONDS = 120;

export class CloudLink extends Context.Service<
  CloudLink,
  {
    readonly state: Effect.Effect<LinkState | null, CloudLinkError>;
    readonly link: (input: { readonly relayUrl: string; readonly accessToken: string; readonly tunnelPort: number }) => Effect.Effect<LinkState, CloudLinkError>;
    readonly unlink: Effect.Effect<void, CloudLinkError | NotLinked>;
    // Tells the relay this host can replace its tunnel, and whether the relay reclaimed it.
    readonly registerRecovery: Effect.Effect<{ readonly tunnelReleased: boolean }, CloudLinkError | NotLinked>;
    // Asks for a replacement under the same hostname, and stores its connector token.
    readonly replaceTunnel: Effect.Effect<LinkState, CloudLinkError | NotLinked>;
    readonly mint: (proof: string) => Effect.Effect<{ credential: string; expiresAt: string; proof: string }, CloudLinkError | NotLinked | ConnectProofRejected | ConnectProofReplayed>;
    readonly health: (proof: string) => Effect.Effect<{ checkedAt: string; descriptor: EnvironmentIdentity.EnvironmentIdentity["Service"]["descriptor"]; proof: string }, CloudLinkError | NotLinked | ConnectProofRejected | ConnectProofReplayed>;
  }
>()("runnerbox/server/CloudLink") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const { descriptor, key } = yield* EnvironmentIdentity.EnvironmentIdentity;
  const auth = yield* AuthStore.AuthStore;
  const statePath = join(serverDir, "connect.json");
  const audience = environmentAudience(descriptor.environmentId);
  const promise = <A>(operation: CloudLinkError["operation"], run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => new CloudLinkError({ operation, cause }) });
  const seconds = Clock.currentTimeMillis.pipe(Effect.map((ms) => Math.floor(ms / 1000)));

  // A missing file reads as empty: not linked yet.
  const readOrEmpty = (path: string) =>
    fs.readFileString(path).pipe(Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error))));

  const state = readOrEmpty(statePath).pipe(
    Effect.flatMap((text) => (text === "" ? Effect.succeed(null) : decodeState(text))),
    Effect.mapError((cause) => new CloudLinkError({ operation: "read", cause })),
  );

  const linked = state.pipe(Effect.flatMap((current) => (current === null ? Effect.fail(new NotLinked()) : Effect.succeed(current))));

  const link = Effect.fn("CloudLink.link")(function* (input: { readonly relayUrl: string; readonly accessToken: string; readonly tunnelPort: number }) {
    const relay = relayClient(input.relayUrl);
    const { publicKey, privateKey } = key;
    const { relayIssuer } = yield* promise("relay", () => relay.config());
    const { challenge } = yield* promise("relay", () => relay.linkChallenge(input.accessToken));
    const now = yield* seconds;
    // The tunnel points only at the loopback listener that serves Connect alone.
    const proof = yield* promise("key", () =>
      signJwt({
        privateKey,
        typ: CONNECT_TYP.linkProof,
        payload: {
          iss: audience,
          aud: relayIssuer,
          sub: descriptor.environmentId,
          jti: crypto.randomUUID(),
          iat: now,
          exp: now + LINK_PROOF_SECONDS,
          challenge,
          environmentId: descriptor.environmentId,
          environmentPublicKey: publicKey,
          descriptor,
          origin: { localHttpHost: "127.0.0.1", localHttpPort: input.tunnelPort },
        },
      }),
    );
    const response = yield* promise("relay", () => relay.link(input.accessToken, proof));
    if (response.environmentId !== descriptor.environmentId || response.relayIssuer !== relayIssuer) {
      return yield* new CloudLinkError({ operation: "relay", cause: new Error("The relay answered for another environment.") });
    }
    const next = { ...response, relayUrl: input.relayUrl, tunnelPort: input.tunnelPort, linkedAt: new Date(now * 1000).toISOString() };
    const { environmentId: _id, ...stored } = next;
    yield* fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(writeFileAtomic(fs, statePath, JSON.stringify(stored, null, 2))),
      Effect.mapError((cause) => new CloudLinkError({ operation: "write", cause })),
    );
    return stored;
  });

  // Signed with the environment's key, so it needs no sign-in. Local state goes only once the
  // relay has agreed, so a failed attempt can be retried.
  const unlink = Effect.gen(function* () {
    const current = yield* linked;
    const { privateKey } = key;
    const now = yield* seconds;
    const proof = yield* promise("key", () =>
      signJwt({
        privateKey,
        typ: CONNECT_TYP.unlinkProof,
        payload: { iss: audience, aud: current.relayIssuer, sub: descriptor.environmentId, jti: crypto.randomUUID(), iat: now, exp: now + LINK_PROOF_SECONDS, environmentId: descriptor.environmentId },
      }),
    );
    yield* promise("relay", () => relayClient(current.relayUrl).unlink(proof));
    yield* fs.remove(statePath).pipe(Effect.mapError((cause) => new CloudLinkError({ operation: "write", cause })));
  }).pipe(Effect.withSpan("CloudLink.unlink"));

  const signRecovery = Effect.fnUntraced(function* (typ: string, current: LinkState) {
    const { privateKey } = key;
    const now = yield* seconds;
    return yield* promise("key", () =>
      signJwt({
        privateKey,
        typ,
        payload: {
          iss: audience,
          aud: current.relayIssuer,
          sub: descriptor.environmentId,
          jti: crypto.randomUUID(),
          iat: now,
          exp: now + LINK_PROOF_SECONDS,
          environmentId: descriptor.environmentId,
          cloudUserId: current.cloudUserId,
          tunnelId: current.tunnelId ?? null,
          origin: { localHttpHost: "127.0.0.1", localHttpPort: current.tunnelPort },
        },
      }),
    );
  });

  const registerRecovery = Effect.gen(function* () {
    const current = yield* linked;
    const proof = yield* signRecovery(CONNECT_TYP.recovery, current);
    return yield* promise("relay", () => relayClient(current.relayUrl).registerRecovery(proof));
  }).pipe(Effect.withSpan("CloudLink.registerRecovery"));

  const replaceTunnel = Effect.gen(function* () {
    const current = yield* linked;
    const proof = yield* signRecovery(CONNECT_TYP.replace, current);
    const replaced = yield* promise("relay", () => relayClient(current.relayUrl).replaceTunnel(proof));
    const next = { ...current, tunnelId: replaced.tunnelId, connectorToken: replaced.connectorToken };
    yield* writeFileAtomic(fs, statePath, JSON.stringify(next, null, 2)).pipe(Effect.mapError((cause) => new CloudLinkError({ operation: "write", cause })));
    return next;
  }).pipe(Effect.withSpan("CloudLink.replaceTunnel"));

  // Checks a relay request: signed by the relay this environment linked to, for this environment
  // and its linked user, current, short-lived, and never seen before.
  const verifyRelayRequest = Effect.fnUntraced(function* <A extends { sub: string; jti: string; iat: number; exp: number; environmentId: string; nonce: string }>(
    request: "mint" | "health",
    proof: string,
    typ: string,
    decode: (payload: unknown) => Effect.Effect<A, unknown>,
  ) {
    const current = yield* linked;
    const now = yield* Clock.currentTimeMillis;
    const payload = yield* Effect.tryPromise(() =>
      verifyJwt({ publicKey: current.relayPublicKey, token: proof, typ, issuer: current.relayIssuer, audience, now }),
    ).pipe(
      Effect.flatMap(decode),
      Effect.mapError(() => new ConnectProofRejected({ request })),
    );
    if (payload.environmentId !== descriptor.environmentId || payload.sub !== current.cloudUserId || !boundedLifetime(payload, now)) {
      return yield* new ConnectProofRejected({ request });
    }
    const expiresAt = payload.exp * 1000;
    const fresh =
      (yield* auth.consumeOnce(`relay-jti:${payload.jti}`, expiresAt).pipe(Effect.orElseSucceed(() => false))) &&
      (yield* auth.consumeOnce(`relay-nonce:${payload.nonce}`, expiresAt).pipe(Effect.orElseSucceed(() => false)));
    if (!fresh) return yield* new ConnectProofReplayed({ request });
    return { current, payload, now };
  });

  const mint = Effect.fn("CloudLink.mint")(function* (proof: string) {
    const { current, payload, now } = yield* verifyRelayRequest("mint", proof, CONNECT_TYP.mintRequest, decodeMintRequest);
    if (payload.cnf.jkt !== payload.clientProofKeyThumbprint || payload.scope.length !== 1 || payload.scope[0] !== "environment:connect") {
      return yield* new ConnectProofRejected({ request: "mint" });
    }
    const code = yield* auth
      .createPairingCode(MCP_SCOPES, { proofKeyThumbprint: payload.clientProofKeyThumbprint, ttlMs: CREDENTIAL_TTL_MS })
      .pipe(Effect.mapError((cause) => new CloudLinkError({ operation: "write", cause })));
    const exp = Math.floor(Date.parse(code.expiresAt) / 1000);
    const { privateKey } = key;
    const signed = yield* promise("key", () =>
      signJwt({
        privateKey,
        typ: CONNECT_TYP.mintResponse,
        payload: {
          iss: audience,
          aud: current.relayIssuer,
          sub: descriptor.environmentId,
          jti: crypto.randomUUID(),
          iat: Math.floor(now / 1000),
          exp,
          environmentId: descriptor.environmentId,
          clientProofKeyThumbprint: payload.clientProofKeyThumbprint,
          requestNonce: payload.nonce,
          credential: code.code,
        },
      }),
    );
    return { credential: code.code, expiresAt: new Date(exp * 1000).toISOString(), proof: signed };
  });

  const health = Effect.fn("CloudLink.health")(function* (proof: string) {
    const { current, payload, now } = yield* verifyRelayRequest("health", proof, CONNECT_TYP.healthRequest, decodeHealthRequest);
    if (payload.scope.length !== 1 || payload.scope[0] !== "environment:status") return yield* new ConnectProofRejected({ request: "health" });
    const checkedAt = new Date(now).toISOString();
    const { privateKey } = key;
    const signed = yield* promise("key", () =>
      signJwt({
        privateKey,
        typ: CONNECT_TYP.healthResponse,
        payload: { iss: audience, aud: current.relayIssuer, sub: descriptor.environmentId, jti: crypto.randomUUID(), iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 60, environmentId: descriptor.environmentId, requestNonce: payload.nonce, checkedAt },
      }),
    );
    return { checkedAt, descriptor, proof: signed };
  });

  return CloudLink.of({ state, link, unlink, registerRecovery, replaceTunnel, mint, health });
});

export const layer = Layer.effect(CloudLink, make);
