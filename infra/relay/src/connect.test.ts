import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClientRuntime, issueTicket, openSession, pairWithCode } from "@runnerbox/client-runtime";
import { createProof, createProofKey, type ProofKey } from "@runnerbox/connect/dpop";
import { generateSigningKeyPair, signJwt } from "@runnerbox/connect/jwt";
import { RelayError, relayClient } from "@runnerbox/connect/relay";
import { CONNECT_TYP, environmentAudience } from "@runnerbox/contracts";
import { startTestServer } from "@runnerbox/server/src/testing/testServer.ts";
import * as Effect from "effect/Effect";
import { createRelay } from "./relay.ts";
import { createStore } from "./store.ts";
import { fakeIdentity, fakeTunnels } from "./testing/fakes.ts";
import { serveFetch } from "./testing/serveFetch.ts";
import { sqliteD1 } from "./testing/sqliteD1.ts";

// The whole Connect exchange, locally: a real runnerbox server, the relay's fetch handler over
// HTTP with D1 on node:sqlite, the server's own link code, and a client with a proof key. Clerk
// and Cloudflare are fakes. Nothing reaches the internet.

let server: Awaited<ReturnType<typeof startTestServer>>;
let relayHttp: Awaited<ReturnType<typeof serveFetch>>;
let relay: ReturnType<typeof createRelay>;
let store: ReturnType<typeof createStore>;
let tunnels: ReturnType<typeof fakeTunnels>;
// Every request the relay sends to an environment goes through here, so a test can watch or
// replace what the environment says.
let toEnvironment: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init);
const sentToEnvironment: string[] = [];

before(async () => {
  server = await startTestServer();
  const keys = await generateSigningKeyPair();
  store = createStore(sqliteD1(), Date.now);
  tunnels = fakeTunnels(() => server.baseUrl);
  relay = createRelay({
    config: {
      issuer: "https://relay.example.com",
      signingPrivateKey: keys.privateKey,
      signingPublicKey: keys.publicKey,
      clerkFrontendApi: "clerk.example.com",
      cliClientId: "cli",
      desktopClientId: "desktop",
      tunnelBaseDomain: "connect.example.com",
      requireHttps: false,
    },
    store,
    identity: fakeIdentity({ "token-alice": "user_alice", "token-bob": "user_bob" }),
    tunnels: tunnels.provider,
    now: Date.now,
    fetch: async (input, init) => {
      if (typeof init?.body === "string") sentToEnvironment.push(init.body);
      return toEnvironment(input, init);
    },
  });
  relayHttp = await serveFetch((request) => relay.fetch(request));
  // `link` checks the relay URL is HTTPS in the CLI; the service itself takes any.
  await Effect.runPromise(server.cloudLink.link({ relayUrl: relayHttp.url, accessToken: "token-alice", port: server.port }));
});

after(async () => {
  await relayHttp.close();
  await server.close();
});

const client = () => relayClient(relayHttp.url);
// The test server's own ID; another test links a second, made-up environment for the same user.
const environmentId = async () => ((await (await fetch(`${server.baseUrl}/.well-known/runnerbox/environment`)).json()) as { environmentId: string }).environmentId;
const prover = (key: ProofKey) => (request: { method: string; url: string }) => createProof(key, request);
const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof RelayError ? error.code : String(error)));

test("a linked environment is listed, online, and a client reads it with a read-only session", async () => {
  const id = await environmentId();
  const listed = (await client().environments("token-alice")).find((environment) => environment.environmentId === id);
  assert.equal(listed?.httpBaseUrl, server.baseUrl);
  assert.equal((await client().status("token-alice", listed!.environmentId)).status, "online");
  assert.ok(tunnels.calls.some((call) => call.endsWith(`-> 127.0.0.1:${server.port}`)), "the tunnel points at the server's loopback port");

  const key = await createProofKey();
  const granted = await client().connect("token-alice", listed!.environmentId, key.thumbprint);
  const paired = await Effect.runPromise(pairWithCode(granted.httpBaseUrl, granted.credential, "connect", prover(key)));
  assert.deepEqual(paired.scopes, ["history:read", "runners:read"]);

  const outcome = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { client: rpc } = yield* openSession(granted.httpBaseUrl, paired.token, prover(key));
        return {
          repos: yield* rpc["history.repos"](),
          // A Connect session can't hand out pairing codes, whatever scopes it asks to pass on.
          delegate: yield* Effect.flip(rpc["access.createPairingCode"]({ scopes: ["history:read"] })),
        };
      }),
    ),
  );
  assert.deepEqual(outcome.repos, ["owner/name", "owner/other"]);
  assert.equal(outcome.delegate._tag === "AuthorizationError" && outcome.delegate.requiredScope, "access:write");
});

test("a credential works once, and only with the key it was minted for", async () => {
  const key = await createProofKey();
  const other = await createProofKey();
  const granted = await client().connect("token-alice", await environmentId(), key.thumbprint);
  const pair = (prove?: ReturnType<typeof prover>) => Effect.runPromise(Effect.flip(pairWithCode(granted.httpBaseUrl, granted.credential, "connect", prove)).pipe(Effect.map((error) => error.reason), Effect.orElseSucceed(() => "paired")));

  assert.equal(await pair(prover(other)), "pairing_rejected", "another key can't redeem it");
  assert.equal(await pair(), "pairing_rejected", "nor can no key at all");
  const paired = await Effect.runPromise(pairWithCode(granted.httpBaseUrl, granted.credential, "connect", prover(key)));
  assert.equal(await pair(prover(key)), "pairing_rejected", "a used credential is spent");

  // The session it bought needs a fresh proof from that key on every use.
  const ticket = (prove?: ReturnType<typeof prover>) => Effect.runPromise(issueTicket(granted.httpBaseUrl, paired.token, prove)).then(() => "ok", () => "refused");
  assert.equal(await ticket(), "refused");
  assert.equal(await ticket(prover(other)), "refused");
  assert.equal(await ticket(prover(key)), "ok");
  const reused = await createProof(key, { method: "POST", url: `${granted.httpBaseUrl}/api/auth/ws-ticket` });
  assert.equal(await ticket(async () => reused), "ok");
  assert.equal(await ticket(async () => reused), "refused", "a proof can't be replayed");
});

test("a user who didn't link the environment gets nothing from the relay", async () => {
  const id = await environmentId();
  const key = await createProofKey();
  assert.equal(await refusal(client().connect("token-bob", id, key.thumbprint)), "environment_link_not_found");
  assert.equal(await refusal(client().status("token-bob", id)), "environment_link_not_found");
  assert.equal(await refusal(client().connect("token-nobody", id, key.thumbprint)), "not_signed_in");
  assert.deepEqual(await client().environments("token-bob"), []);
});

test("the environment refuses relay requests it didn't get from its relay, or got before", async () => {
  const id = await environmentId();
  const key = await createProofKey();
  const mint = (proof: string) => fetch(`${server.baseUrl}/api/connect/mint`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof }) }).then((response) => response.status);
  const forger = await generateSigningKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const payload = (overrides: Record<string, unknown> = {}) => ({
    iss: "https://relay.example.com",
    aud: environmentAudience(id),
    sub: "user_alice",
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 120,
    environmentId: id,
    clientProofKeyThumbprint: key.thumbprint,
    cnf: { jkt: key.thumbprint },
    nonce: crypto.randomUUID(),
    scope: ["environment:connect"],
    ...overrides,
  });
  assert.equal(await mint(await signJwt({ privateKey: forger.privateKey, typ: CONNECT_TYP.mintRequest, payload: payload() })), 401, "signed by another key");

  // A genuine relay request, captured on its way to the environment, can't be sent again.
  sentToEnvironment.length = 0;
  await client().connect("token-alice", id, key.thumbprint);
  const captured = JSON.parse(sentToEnvironment.at(-1)!) as { proof: string };
  assert.equal(await mint(captured.proof), 409);
});

test("the relay rejects an answer that isn't the linked environment's, or that redirects", async () => {
  const id = await environmentId();
  const key = await createProofKey();
  const impostor = await generateSigningKeyPair();
  try {
    // Another process behind the tunnel, signing with a key of its own.
    toEnvironment = async () => {
      const now = Math.floor(Date.now() / 1000);
      const credential = "AAAAA-BBBBB-CCCCC-DDDDD";
      const proof = await signJwt({
        privateKey: impostor.privateKey,
        typ: CONNECT_TYP.mintResponse,
        payload: { iss: environmentAudience(id), aud: "https://relay.example.com", sub: id, jti: crypto.randomUUID(), iat: now, exp: now + 120, environmentId: id, clientProofKeyThumbprint: key.thumbprint, requestNonce: "guess", credential },
      });
      return Response.json({ credential, expiresAt: new Date((now + 120) * 1000).toISOString(), proof });
    };
    assert.equal(await refusal(client().connect("token-alice", id, key.thumbprint)), "environment_response_invalid");
    toEnvironment = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    assert.equal(await refusal(client().connect("token-alice", id, key.thumbprint)), "environment_redirected");
    assert.equal((await client().status("token-alice", id)).status, "offline");
  } finally {
    toEnvironment = (input, init) => fetch(input, init);
  }
});

test("a link proof is refused when replayed, for another user's challenge, or for a non-loopback origin", async () => {
  const keys = await generateSigningKeyPair();
  const proofFor = async (challengeToken: string, origin = { localHttpHost: "127.0.0.1", localHttpPort: 4517 }) => {
    const { challenge } = await client().linkChallenge(challengeToken);
    const now = Math.floor(Date.now() / 1000);
    const id = "11111111-2222-3333-4444-555555555555";
    return signJwt({
      privateKey: keys.privateKey,
      typ: CONNECT_TYP.linkProof,
      payload: {
        iss: environmentAudience(id),
        aud: "https://relay.example.com",
        sub: id,
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + 120,
        challenge,
        environmentId: id,
        environmentPublicKey: keys.publicKey,
        descriptor: { environmentId: id, label: "example", serverVersion: "0.0.0", protocolVersion: 1 },
        origin,
      },
    });
  };
  const proof = await proofFor("token-alice");
  assert.equal((await client().link("token-alice", proof)).environmentId, "11111111-2222-3333-4444-555555555555");
  assert.equal(await refusal(client().link("token-alice", proof)), "replayed");
  assert.equal(await refusal(client().link("token-alice", await proofFor("token-bob"))), "challenge_invalid");
  assert.equal(await refusal(client().link("token-alice", await proofFor("token-alice", { localHttpHost: "192.168.122.1", localHttpPort: 4517 }))), "origin_not_allowed");
});

test("teardown claims the allocation first, so a stale cleanup never deletes a newer tunnel", async () => {
  const key = { userId: "user_alice", environmentId: "11111111-2222-3333-4444-555555555555" };
  const read = await store.allocation(key);
  // A relink while a cleanup is in flight bumps the generation the cleanup read.
  await store.beginAllocation(key, { hostname: read!.hostname, httpBaseUrl: read!.http_base_url, originHost: "127.0.0.1", originPort: 4517 });
  const releasesBefore = tunnels.calls.filter((call) => call.startsWith("release")).length;
  assert.equal(await store.claimForTeardown(key, read!.generation), false);
  assert.equal(tunnels.calls.filter((call) => call.startsWith("release")).length, releasesBefore);
  assert.equal(await relay.releaseAllocation(key), true, "a claim at the current generation goes through");
  assert.equal(await store.allocation(key), null);
});

test("a saved environment whose first route is down connects through Connect instead", async () => {
  const id = await environmentId();
  const runtime = createClientRuntime({
    catalog: { list: async () => [], save: async () => {}, remove: async () => {} },
    // What desktop main does with its Clerk sign-in, here with the fake one.
    connect: {
      status: async () => ({ relayUrl: relayHttp.url, signedIn: true }),
      signIn: async () => {},
      signOut: async () => {},
      environments: () => client().environments("token-alice"),
      requestCredential: (environmentId, thumbprint) => client().connect("token-alice", environmentId, thumbprint),
    },
  });
  await runtime.addConnectRoute({ environmentId: id, label: "example" }, relayHttp.url);
  // Put a dead loopback route in front, as if the app had paired on a network it's no longer on.
  const saved = runtime.store.getState().environments[0]!;
  runtime.store.setState({ environments: [{ ...saved, routes: [{ kind: "direct", url: "http://127.0.0.1:9" }, ...saved.routes], token: "rbx_stale" }] });
  runtime.reconnect(id);
  const connected = await new Promise<{ route: string; repos: readonly string[] }>((resolve) => {
    const unsubscribe = runtime.store.subscribe((state) => {
      const connection = state.connections[id];
      if (connection?.status !== "connected") return;
      unsubscribe();
      void runtime.run(id, (rpc) => rpc["history.repos"]()).then((repos) => resolve({ route: connection.route.kind, repos }));
    });
  });
  assert.deepEqual(connected, { route: "connect", repos: ["owner/name", "owner/other"] });
  await runtime.remove(id);
});

test("unlinking with the environment's key removes the link and its tunnel", async () => {
  const id = await environmentId();
  await Effect.runPromise(server.cloudLink.unlink);
  assert.ok(!(await client().environments("token-alice")).some((environment) => environment.environmentId === id));
  assert.ok(tunnels.calls.at(-1)?.startsWith("release tunnel-1"));
  const key = await createProofKey();
  assert.equal(await refusal(client().connect("token-alice", id, key.thumbprint)), "environment_link_not_found");
  assert.equal(await Effect.runPromise(server.cloudLink.state), null);
});
