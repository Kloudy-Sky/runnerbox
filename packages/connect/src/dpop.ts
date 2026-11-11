import { calculateJwkThumbprint, decodeProtectedHeader, exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT, EmbeddedJWK } from "jose";

// DPoP (RFC 9449) proofs: a client signs each request with a key only it holds, so a Connect
// credential or session captured on the wire can't be used without that key.

export const DPOP_TYP = "dpop+jwt";
const MAX_AGE_SECONDS = 60;

export type ProofKey = { readonly privateKey: CryptoKey; readonly publicJwk: JWK; readonly thumbprint: string };

// The private key can't be exported, so it lives and dies with this process.
export async function createProofKey(): Promise<ProofKey> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: false });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, publicJwk, thumbprint: await calculateJwkThumbprint(publicJwk) };
}

export function createProof(key: ProofKey, request: { method: string; url: string }) {
  return new SignJWT({ htm: request.method.toUpperCase(), htu: request.url, jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: "ES256", typ: DPOP_TYP, jwk: key.publicJwk })
    .setIssuedAt()
    .sign(key.privateKey);
}

export class DpopError extends Error {}

// Checks a proof's signature against its own embedded key, its method and path, and its age, and
// returns the key's thumbprint and the proof's `jti` for the caller's replay guard. The path is
// compared rather than the whole URL, because behind a tunnel the server can't see the host and
// scheme the client used.
export async function verifyProof(proof: string, request: { method: string; path: string; now: number }) {
  try {
    const header = decodeProtectedHeader(proof);
    if (header.typ !== DPOP_TYP || header.alg !== "ES256" || !header.jwk || "d" in header.jwk) throw new DpopError("bad header");
    const { payload } = await jwtVerify(proof, EmbeddedJWK, { typ: DPOP_TYP, algorithms: ["ES256"], maxTokenAge: MAX_AGE_SECONDS, clockTolerance: 30, currentDate: new Date(request.now) });
    if (payload.htm !== request.method.toUpperCase() || typeof payload.htu !== "string" || new URL(payload.htu).pathname !== request.path || typeof payload.jti !== "string") {
      throw new DpopError("proof is for another request");
    }
    return { thumbprint: await calculateJwkThumbprint(header.jwk), jti: payload.jti, expiresAt: ((payload.iat ?? 0) + MAX_AGE_SECONDS + 30) * 1000 };
  } catch (error) {
    throw error instanceof DpopError ? error : new DpopError(error instanceof Error ? error.message : "invalid proof");
  }
}
