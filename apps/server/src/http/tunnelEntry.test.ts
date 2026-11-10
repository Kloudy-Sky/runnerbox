import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { issueTicket, pairWithCode } from "@runnerbox/client-runtime";
import { createProof, createProofKey } from "@runnerbox/connect/dpop";
import * as Effect from "effect/Effect";
import { startTestServer } from "../testing/testServer.ts";

// The tunnel-facing listener, which only cloudflared points at, accepts key-bound Connect
// credentials and their sessions and nothing else. The loopback listener is unchanged.

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer({ fixtures: false });
});
after(() => server.close());

const status = (base: string, path: string, init: RequestInit = {}) => fetch(`${base}${path}`, init).then((response) => response.status);
const reason = (effect: Effect.Effect<unknown, { reason: string }>) => Effect.runPromise(Effect.flip(effect).pipe(Effect.map((error) => error.reason), Effect.orElseSucceed(() => "ok")));

test("a CLI pairing code can't be redeemed through the tunnel, and stays good on loopback", async () => {
  const { code } = await server.createPairingCode(["history:read"]);
  assert.equal(await reason(pairWithCode(server.tunnelBaseUrl, code, "remote")), "pairing_rejected");
  // Even with a proof key, since the code isn't bound to one.
  const key = await createProofKey();
  assert.equal(await reason(pairWithCode(server.tunnelBaseUrl, code, "remote", (request) => createProof(key, request))), "pairing_rejected");
  assert.equal(await reason(pairWithCode(server.baseUrl, code, "local")), "ok");
});

test("an app session or a loopback ticket gets nothing through the tunnel", async () => {
  const { code } = await server.createPairingCode(["history:read", "runners:read", "access:write"]);
  const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "local"));
  assert.equal(await reason(issueTicket(server.tunnelBaseUrl, token)), "unauthorized");
  const { ticket } = await Effect.runPromise(issueTicket(server.baseUrl, token));
  const opens = (base: string) =>
    new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`${base.replace("http", "ws")}/ws?ticket=${ticket}`);
      socket.onopen = () => (socket.close(), resolve(true));
      socket.onerror = () => resolve(false);
    });
  assert.equal(await opens(server.tunnelBaseUrl), false, "a ticket opens a socket only on the listener that issued it");
});

test("MCP isn't served through the tunnel, and the relay's endpoints aren't served on loopback", async () => {
  const token = await server.mintMcpToken();
  const mcp = { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" };
  assert.equal(await status(server.tunnelBaseUrl, "/mcp", mcp), 404);
  assert.notEqual(await status(server.baseUrl, "/mcp", mcp), 404);
  const mint = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: "x" }) };
  assert.equal(await status(server.baseUrl, "/api/connect/mint", mint), 404);
  const served = await fetch(`${server.tunnelBaseUrl}/api/connect/mint`, mint).then((response) => response.json());
  assert.deepEqual(served, { error: "not_linked" }, "served on the tunnel, and refused since this test server isn't linked");
});

test("a key-bound credential and its session work through the tunnel, with that key only", async () => {
  const key = await createProofKey();
  const prove = (request: { method: string; url: string }) => createProof(key, request);
  const { code } = await Effect.runPromise(server.auth.createPairingCode(["history:read", "runners:read", "access:write"], { proofKeyThumbprint: key.thumbprint }));
  const paired = await Effect.runPromise(pairWithCode(server.tunnelBaseUrl, code, "connect", prove));
  assert.deepEqual(paired.scopes, ["history:read", "runners:read"]);
  assert.equal(await reason(issueTicket(server.tunnelBaseUrl, paired.token, prove)), "ok");
  assert.equal(await reason(issueTicket(server.tunnelBaseUrl, paired.token)), "unauthorized");
});
