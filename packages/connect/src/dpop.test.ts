import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeJwt } from "jose";
import { createProof, createProofKey, verifyProof } from "./dpop.ts";

test("a proof's replay record outlasts the last moment the proof is still accepted", async () => {
  const key = await createProofKey();
  const proof = await createProof(key, { method: "POST", url: "https://example.com/api/auth/ws-ticket" });
  const iat = decodeJwt(proof).iat!;
  // The latest instant jose still accepts it: whole seconds, so 90.5 s counts as 90.
  const lastAccepted = iat * 1000 + 90_500;
  const verified = await verifyProof(proof, { method: "POST", path: "/api/auth/ws-ticket", now: lastAccepted });
  assert.ok(verified.expiresAt > lastAccepted, `the record expires at ${verified.expiresAt}, before ${lastAccepted}`);
  await assert.rejects(verifyProof(proof, { method: "POST", path: "/api/auth/ws-ticket", now: verified.expiresAt }));
});
