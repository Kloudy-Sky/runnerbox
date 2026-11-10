import { boundedLifetime, signJwt, verifyJwt } from "@runnerbox/connect/jwt";
import {
  CONNECT_TYP,
  ConnectRequest,
  environmentAudience,
  HealthResponse,
  HealthResponsePayload,
  LinkProofPayload,
  MintResponse,
  MintResponsePayload,
  SignedRequest,
  UnlinkProofPayload,
} from "@runnerbox/contracts";
import * as Schema from "effect/Schema";
import { decodeJwt } from "jose";
import type { IdentityVerifier } from "./identity.ts";
import type { Link, RelayStore } from "./store.ts";
import type { TunnelProvider } from "./tunnels.ts";

// The Runnerbox Connect relay. It knows who a user is (Clerk), which environments they linked,
// and the tunnel each one has. It asks an environment to mint a one-time credential bound to a
// client's key and checks the environment's signed answer. It never sees an environment session
// and never carries app traffic: clients talk to the environment's own hostname.

export type RelayConfig = {
  issuer: string;
  signingPrivateKey: string;
  signingPublicKey: string;
  clerkFrontendApi: string;
  cliClientId: string;
  desktopClientId: string;
  tunnelBaseDomain: string;
  // Off only in tests, where the fake tunnel answers on plain HTTP.
  requireHttps: boolean;
};

export type RelayDeps = {
  config: RelayConfig;
  store: RelayStore;
  identity: IdentityVerifier;
  tunnels: TunnelProvider;
  now: () => number;
  fetch: typeof fetch;
};

const CHALLENGE_TYP = "rbx-relay-challenge+jwt";
const PROOF_SECONDS = 120;
const ENVIRONMENT_TIMEOUT_MS = 10_000;

class Refusal extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const decodeLinkProof = Schema.decodeUnknownSync(LinkProofPayload);
const decodeUnlinkProof = Schema.decodeUnknownSync(UnlinkProofPayload);
const decodeSigned = Schema.decodeUnknownSync(SignedRequest);
const decodeConnect = Schema.decodeUnknownSync(ConnectRequest);
const decodeMintResponse = Schema.decodeUnknownSync(MintResponse);
const decodeMintResponsePayload = Schema.decodeUnknownSync(MintResponsePayload);
const decodeHealthResponse = Schema.decodeUnknownSync(HealthResponse);
const decodeHealthResponsePayload = Schema.decodeUnknownSync(HealthResponsePayload);

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRelay(deps: RelayDeps) {
  const { config, store, identity, tunnels, now } = deps;
  const seconds = () => Math.floor(now() / 1000);
  const issuer = config.issuer.replace(/\/+$/, "");

  const sign = (typ: string, payload: Record<string, unknown>) => signJwt({ privateKey: config.signingPrivateKey, typ, payload });

  async function userOf(request: Request) {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const user = token ? await identity.verify(token) : null;
    if (!user) throw new Refusal(401, "not_signed_in");
    return user.userId;
  }

  async function body(request: Request) {
    try {
      return (await request.json()) as unknown;
    } catch {
      throw new Refusal(400, "invalid_request");
    }
  }

  // Asks the environment, at the address the relay itself allocated, and refuses a redirect: a
  // health or mint request must never be bounced to some other host.
  async function askEnvironment(link: Link, path: string, proof: string) {
    const response = await deps
      .fetch(new URL(path, link.http_base_url), {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof }),
        signal: AbortSignal.timeout(ENVIRONMENT_TIMEOUT_MS),
      })
      .catch(() => {
        throw new Refusal(504, "environment_unreachable");
      });
    if (response.status >= 300 && response.status < 400) throw new Refusal(502, "environment_redirected");
    if (!response.ok) throw new Refusal(502, `environment_refused_${response.status}`);
    return response.json().catch(() => {
      throw new Refusal(502, "environment_response_invalid");
    });
  }

  // The link this user has to this environment, served from the relay's own allocation.
  async function readyLink(userId: string, environmentId: string) {
    const link = await store.link({ userId, environmentId });
    if (!link) throw new Refusal(403, "environment_link_not_found");
    const allocation = await store.allocation({ userId, environmentId });
    if (!allocation || allocation.state !== "ready" || allocation.http_base_url !== link.http_base_url) throw new Refusal(409, "managed_endpoint_not_ready");
    return link;
  }

  const routes: Record<string, (request: Request, match: RegExpExecArray) => Promise<Response>> = {
    "GET /v1/config": async () =>
      json({ relayIssuer: issuer, clerkFrontendApi: config.clerkFrontendApi, cliClientId: config.cliClientId, desktopClientId: config.desktopClientId }),

    // A one-use challenge naming the signed-in user, which the environment signs into its link proof.
    "POST /v1/link/challenge": async (request) => {
      const userId = await userOf(request);
      const exp = seconds() + PROOF_SECONDS;
      const challenge = await sign(CHALLENGE_TYP, { iss: issuer, aud: issuer, sub: userId, jti: crypto.randomUUID(), iat: seconds(), exp });
      return json({ challenge, expiresAt: new Date(exp * 1000).toISOString() });
    },

    "POST /v1/link": async (request) => {
      const userId = await userOf(request);
      const { proof } = decodeSigned(await body(request));
      // The proof names its own key; it must then verify under that key for that environment.
      let candidate: LinkProofPayload;
      try {
        candidate = decodeLinkProof(decodeJwt(proof));
      } catch {
        throw new Refusal(400, "link_proof_invalid");
      }
      const verified = await verifyJwt({
        publicKey: candidate.environmentPublicKey,
        token: proof,
        typ: CONNECT_TYP.linkProof,
        issuer: environmentAudience(candidate.environmentId),
        audience: issuer,
        now: now(),
      }).catch(() => null);
      if (!verified || candidate.sub !== candidate.environmentId || candidate.descriptor.environmentId !== candidate.environmentId || !boundedLifetime(candidate, now())) {
        throw new Refusal(400, "link_proof_invalid");
      }
      const challenge = await verifyJwt({ publicKey: config.signingPublicKey, token: candidate.challenge, typ: CHALLENGE_TYP, issuer, audience: issuer, now: now() }).catch(() => null);
      if (!challenge || challenge.sub !== userId || typeof challenge.jti !== "string") throw new Refusal(400, "challenge_invalid");
      // Tunnels reach only a loopback port on the environment, never another host on its network.
      const { localHttpHost, localHttpPort } = candidate.origin;
      if (!LOOPBACK.has(localHttpHost.toLowerCase()) || !Number.isInteger(localHttpPort) || localHttpPort < 1 || localHttpPort > 65535) {
        throw new Refusal(400, "origin_not_allowed");
      }
      const expiresAt = candidate.exp * 1000;
      if (!(await store.consumeOnce(`link-proof:${candidate.environmentId}:${candidate.jti}`, expiresAt)) || !(await store.consumeOnce(`challenge:${challenge.jti}`, expiresAt))) {
        throw new Refusal(400, "replayed");
      }

      const key = { userId, environmentId: candidate.environmentId };
      // Named from the user and environment together, so the hostname gives away neither.
      const name = `rbx-${(await sha256Hex(`${userId}\0${candidate.environmentId}`)).slice(0, 16)}`;
      const hostname = `${name}.${config.tunnelBaseDomain}`;
      const httpBaseUrl = tunnels.baseUrlFor(hostname);
      if (config.requireHttps && !httpBaseUrl.startsWith("https://")) throw new Refusal(500, "endpoint_not_secure");
      const previous = await store.allocation(key);
      const allocation = await store.beginAllocation(key, { hostname, httpBaseUrl, originHost: localHttpHost, originPort: localHttpPort });
      const provisioned = await tunnels
        .provision({
          name,
          hostname,
          origin: { host: localHttpHost, port: localHttpPort },
          // A row left mid-teardown has resources that may already be gone, so start fresh.
          existing: previous?.state === "deleting" ? { tunnelId: null, dnsRecordId: null } : { tunnelId: allocation.tunnel_id, dnsRecordId: allocation.dns_record_id },
          onTunnel: async (tunnelId) => void (await store.checkpoint(key, allocation.generation, { tunnelId })),
        })
        .catch(() => {
          throw new Refusal(502, "tunnel_provisioning_failed");
        });
      await store.checkpoint(key, allocation.generation, { tunnelId: provisioned.tunnelId, dnsRecordId: provisioned.dnsRecordId, ready: true });
      await store.upsertLink({
        user_id: userId,
        environment_id: candidate.environmentId,
        label: candidate.descriptor.label,
        environment_public_key: candidate.environmentPublicKey,
        http_base_url: httpBaseUrl,
      });
      return json({
        environmentId: candidate.environmentId,
        cloudUserId: userId,
        httpBaseUrl,
        connectorToken: provisioned.connectorToken,
        relayIssuer: issuer,
        relayPublicKey: config.signingPublicKey,
      });
    },

    // Signed by the environment's key, so a machine can leave without its owner signing in.
    // Revocation commits before teardown: if teardown fails, the link is gone but the claimed row
    // remains for a later attempt.
    "POST /v1/unlink": async (request) => {
      const { proof } = decodeSigned(await body(request));
      let claimed: typeof UnlinkProofPayload.Type;
      try {
        claimed = decodeUnlinkProof(decodeJwt(proof));
      } catch {
        throw new Refusal(400, "unlink_proof_invalid");
      }
      const links = await store.linksForEnvironment(claimed.environmentId);
      let removed = 0;
      for (const link of links) {
        const verified = await verifyJwt({ publicKey: link.environment_public_key, token: proof, typ: CONNECT_TYP.unlinkProof, issuer: environmentAudience(link.environment_id), audience: issuer, now: now() }).catch(() => null);
        if (!verified || !boundedLifetime(claimed, now())) continue;
        if (!(await store.consumeOnce(`unlink-proof:${link.environment_id}:${link.user_id}:${claimed.jti}`, claimed.exp * 1000))) throw new Refusal(400, "replayed");
        const key = { userId: link.user_id, environmentId: link.environment_id };
        await store.deleteLink(key);
        await releaseAllocation(key);
        removed++;
      }
      if (removed === 0) throw new Refusal(403, "unlink_proof_invalid");
      return json({ ok: true });
    },

    "GET /v1/environments": async (request) => {
      const userId = await userOf(request);
      const links = await store.linksForUser(userId);
      return json(links.map((link) => ({ environmentId: link.environment_id, label: link.label, httpBaseUrl: link.http_base_url, linkedAt: link.linked_at })));
    },

    "POST /v1/environments/([^/]+)/connect": async (request, match) => {
      const userId = await userOf(request);
      const environmentId = decodeURIComponent(match[1]!);
      const { clientProofKeyThumbprint } = decodeConnect(await body(request));
      if (!clientProofKeyThumbprint.trim()) throw new Refusal(400, "client_proof_key_missing");
      const link = await readyLink(userId, environmentId);
      const nonce = crypto.randomUUID();
      const proof = await sign(CONNECT_TYP.mintRequest, {
        iss: issuer,
        aud: environmentAudience(environmentId),
        sub: userId,
        jti: crypto.randomUUID(),
        iat: seconds(),
        exp: seconds() + PROOF_SECONDS,
        environmentId,
        clientProofKeyThumbprint,
        cnf: { jkt: clientProofKeyThumbprint },
        nonce,
        scope: ["environment:connect"],
      });
      const answer = decodeMintResponse(await askEnvironment(link, "/api/connect/mint", proof));
      // Only the linked environment's key can produce this, bound to our nonce and the client's key,
      // so another process behind the tunnel can't hand the client its own credential.
      const signed = await verifyJwt({ publicKey: link.environment_public_key, token: answer.proof, typ: CONNECT_TYP.mintResponse, issuer: environmentAudience(environmentId), audience: issuer, now: now() })
        .then(decodeMintResponsePayload)
        .catch(() => null);
      if (
        !signed ||
        signed.environmentId !== environmentId ||
        signed.requestNonce !== nonce ||
        signed.clientProofKeyThumbprint !== clientProofKeyThumbprint ||
        signed.credential !== answer.credential ||
        signed.exp !== Math.floor(Date.parse(answer.expiresAt) / 1000)
      ) {
        throw new Refusal(502, "environment_response_invalid");
      }
      return json({ environmentId, httpBaseUrl: link.http_base_url, credential: answer.credential, expiresAt: answer.expiresAt });
    },

    "GET /v1/environments/([^/]+)/status": async (request, match) => {
      const userId = await userOf(request);
      const environmentId = decodeURIComponent(match[1]!);
      const link = await readyLink(userId, environmentId);
      const nonce = crypto.randomUUID();
      const proof = await sign(CONNECT_TYP.healthRequest, {
        iss: issuer,
        aud: environmentAudience(environmentId),
        sub: userId,
        jti: crypto.randomUUID(),
        iat: seconds(),
        exp: seconds() + PROOF_SECONDS,
        environmentId,
        nonce,
        scope: ["environment:status"],
      });
      const answer = await askEnvironment(link, "/api/connect/health", proof).then(decodeHealthResponse).catch(() => null);
      const signed = answer
        ? await verifyJwt({ publicKey: link.environment_public_key, token: answer.proof, typ: CONNECT_TYP.healthResponse, issuer: environmentAudience(environmentId), audience: issuer, now: now() })
            .then(decodeHealthResponsePayload)
            .catch(() => null)
        : null;
      const online = answer !== null && signed !== null && signed.requestNonce === nonce && signed.environmentId === environmentId && signed.checkedAt === answer.checkedAt;
      return json({ environmentId, status: online ? "online" : "offline", checkedAt: online ? answer.checkedAt : null });
    },
  };

  // Tears down an allocation's tunnel only after claiming its current generation.
  async function releaseAllocation(key: { userId: string; environmentId: string }) {
    const allocation = await store.allocation(key);
    if (!allocation || !(await store.claimForTeardown(key, allocation.generation))) return false;
    await tunnels.release({ tunnelId: allocation.tunnel_id, dnsRecordId: allocation.dns_record_id });
    await store.deleteClaimed(key, allocation.generation + 1);
    return true;
  }

  return {
    releaseAllocation,
    async fetch(request: Request) {
      const { pathname } = new URL(request.url);
      for (const [route, handle] of Object.entries(routes)) {
        const [method, pattern] = route.split(" ") as [string, string];
        const match = new RegExp(`^${pattern}$`).exec(pathname);
        if (match && request.method === method) {
          try {
            return await handle(request, match);
          } catch (error) {
            if (error instanceof Refusal) return json({ error: error.message }, error.status);
            if (error instanceof Error && error.name === "SchemaError") return json({ error: "invalid_request" }, 400);
            console.error("relay error", error instanceof Error ? error.name : "unknown");
            return json({ error: "internal_error" }, 500);
          }
        }
      }
      return json({ error: "not_found" }, 404);
    },
  };
}
