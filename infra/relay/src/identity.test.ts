import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { clerkIdentity } from "./identity.ts";

// A stand-in for a Clerk instance's JWKS, with tokens signed here as Clerk would sign them.
test("only a Clerk JWT issued to the relay's own clients counts, and opaque tokens are refused", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/.well-known/jwks.json") return void response.end(JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] }));
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sub: "user_from_userinfo" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const identity = clerkIdentity({ frontendApi: base, clientIds: ["cli", "desktop"] });
    const token = (claims: Record<string, unknown>) =>
      new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(base).setSubject("user_alice").setIssuedAt().setExpirationTime("5m").sign(privateKey);

    assert.deepEqual(await identity.verify(await token({ client_id: "cli" })), { userId: "user_alice" });
    assert.deepEqual(await identity.verify(await token({ azp: "desktop" })), { userId: "user_alice" });
    assert.equal(await identity.verify(await token({ client_id: "another-app" })), null, "another app's token on the same Clerk instance");
    assert.equal(await identity.verify(await token({})), null, "a token naming no client");
    assert.equal(await identity.verify("opaque-oauth-token"), null);
    assert.ok(!requests.some((url) => url.includes("userinfo")), "no fallback to userinfo");
  } finally {
    server.close();
  }
});
