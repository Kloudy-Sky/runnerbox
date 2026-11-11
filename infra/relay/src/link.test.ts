import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSigningKeyPair, signJwt } from "@runnerbox/connect/jwt";
import { CONNECT_TYP, environmentAudience } from "@runnerbox/contracts";
import { createRelay } from "./relay.ts";
import { createStore } from "./store.ts";
import { fakeIdentity, fakeTunnels } from "./testing/fakes.ts";
import { sqliteD1 } from "./testing/sqliteD1.ts";

// Linking, on a relay whose clock the test moves. No environment server is needed: proofs are
// signed here with keys made for the test.

const ENVIRONMENT = "11111111-2222-3333-4444-555555555555";
const ISSUER = "https://relay.example.com";

async function setup() {
  let clock = Date.parse("2026-06-01T12:00:00Z");
  const now = () => clock;
  const keys = await generateSigningKeyPair();
  const store = createStore(sqliteD1(), now);
  const tunnels = fakeTunnels(() => "http://127.0.0.1:9");
  const relay = createRelay({
    config: { issuer: ISSUER, signingPrivateKey: keys.privateKey, signingPublicKey: keys.publicKey, clerkFrontendApi: "clerk.example.com", cliClientId: "cli", desktopClientId: "desktop", tunnelBaseDomain: "example.com", requireHttps: false, cleanupMode: "off" },
    store,
    identity: fakeIdentity({ "token-alice": "user_alice" }),
    tunnels: tunnels.provider,
    now,
    fetch,
  });
  const call = async (path: string, body?: object, token = "token-alice") => {
    const response = await relay.fetch(new Request(`${ISSUER}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: (await response.json()) as { error?: string; challenge?: string } };
  };
  const challenge = async () => (await call("/v1/link/challenge")).body.challenge!;
  const linkProof = async (environment: { publicKey: string; privateKey: string }, challengeToken: string, { lifetime = 120, port = 4518 } = {}) => {
    const iat = Math.floor(clock / 1000);
    return signJwt({
      privateKey: environment.privateKey,
      typ: CONNECT_TYP.linkProof,
      payload: {
        iss: environmentAudience(ENVIRONMENT), aud: ISSUER, sub: ENVIRONMENT, jti: crypto.randomUUID(), iat, exp: iat + lifetime,
        challenge: challengeToken, environmentId: ENVIRONMENT, environmentPublicKey: environment.publicKey,
        descriptor: { environmentId: ENVIRONMENT, label: "example", serverVersion: "0.0.0", protocolVersion: 1 },
        origin: { localHttpHost: "127.0.0.1", localHttpPort: port },
      },
    });
  };
  const unlinkProof = async (environment: { privateKey: string }) => {
    const iat = Math.floor(clock / 1000);
    return signJwt({ privateKey: environment.privateKey, typ: CONNECT_TYP.unlinkProof, payload: { iss: environmentAudience(ENVIRONMENT), aud: ISSUER, sub: ENVIRONMENT, jti: crypto.randomUUID(), iat, exp: iat + 120, environmentId: ENVIRONMENT } });
  };
  return { call, challenge, linkProof, unlinkProof, store, tunnels, advance: (seconds: number) => void (clock += seconds * 1000) };
}

test("a link stays pinned to its key: a second key can't take over the tunnel, until the first unlinks", async () => {
  const { call, challenge, linkProof, unlinkProof, store, tunnels } = await setup();
  const owner = await generateSigningKeyPair();
  const intruder = await generateSigningKeyPair();
  assert.equal((await call("/v1/link", { proof: await linkProof(owner, await challenge()) })).status, 200);
  const before = tunnels.calls.length;

  // Someone with the same sign-in, pointing the tunnel at another port with a key of their own.
  const takeover = await call("/v1/link", { proof: await linkProof(intruder, await challenge(), { port: 22 }) });
  assert.deepEqual([takeover.status, takeover.body.error], [409, "environment_key_mismatch"]);
  assert.equal(tunnels.calls.length, before, "the tunnel wasn't touched");
  const link = await store.link({ userId: "user_alice", environmentId: ENVIRONMENT });
  assert.equal(link?.environment_public_key, owner.publicKey);
  assert.equal((await store.allocation({ userId: "user_alice", environmentId: ENVIRONMENT }))?.origin_port, 4518);

  // Only an unlink signed by the pinned key frees it.
  assert.equal((await call("/v1/unlink", { proof: await unlinkProof(intruder) })).status, 403);
  assert.equal((await call("/v1/unlink", { proof: await unlinkProof(owner) })).status, 200);
  assert.equal((await call("/v1/link", { proof: await linkProof(intruder, await challenge()) })).status, 200);
});

test("a challenge stays used until it expires, even after a shorter-lived proof that used it has expired", async () => {
  const { call, challenge, linkProof, advance } = await setup();
  const environment = await generateSigningKeyPair();
  const once = await challenge();
  assert.equal((await call("/v1/link", { proof: await linkProof(environment, once, { lifetime: 5 }) })).status, 200);
  advance(30);
  const again = await call("/v1/link", { proof: await linkProof(environment, once) });
  assert.deepEqual([again.status, again.body.error], [400, "replayed"]);
});

test("of two first links racing under different keys, one wins and the other gets no tunnel or token", async () => {
  const { call, challenge, linkProof, store, tunnels } = await setup();
  const first = await generateSigningKeyPair();
  const second = await generateSigningKeyPair();
  const proofs = [await linkProof(first, await challenge()), await linkProof(second, await challenge(), { port: 22 })];
  const answers = await Promise.all(proofs.map((proof) => call("/v1/link", { proof })));
  assert.deepEqual(answers.map((answer) => answer.status).toSorted(), [200, 409]);
  assert.equal(answers.filter((answer) => "connectorToken" in answer.body).length, 1, "only the winner gets a connector token");
  assert.equal(tunnels.calls.filter((entry) => entry.startsWith("provision")).length, 1);
  const winner = answers[0]!.status === 200 ? first : second;
  assert.equal((await store.link({ userId: "user_alice", environmentId: ENVIRONMENT }))?.environment_public_key, winner.publicKey);
});
