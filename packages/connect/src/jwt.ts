import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";

// Ed25519-signed JWTs for the messages between relay and environment. Each side checks the other's
// signature, the `typ` that names the step, and who it's from and for.

export type KeyPairPem = { readonly publicKey: string; readonly privateKey: string };

export async function generateSigningKeyPair(): Promise<KeyPairPem> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  return { publicKey: await exportSPKI(publicKey), privateKey: await exportPKCS8(privateKey) };
}

export async function signJwt(input: { privateKey: string; typ: string; payload: JWTPayload }) {
  const key = await importPKCS8(input.privateKey, "EdDSA");
  return new SignJWT(input.payload).setProtectedHeader({ alg: "EdDSA", typ: input.typ }).sign(key);
}

// Throws unless the token is signed by `publicKey`, has this `typ`, issuer and audience, is
// current, and was issued within `maxAgeSeconds`.
export async function verifyJwt(input: {
  publicKey: string;
  token: string;
  typ: string;
  issuer: string;
  audience: string;
  now: number;
  maxAgeSeconds?: number;
}) {
  const key = await importSPKI(input.publicKey, "EdDSA");
  const { payload } = await jwtVerify(input.token, key, {
    algorithms: ["EdDSA"],
    typ: input.typ,
    issuer: input.issuer,
    audience: input.audience,
    maxTokenAge: input.maxAgeSeconds ?? 300,
    clockTolerance: 60,
    currentDate: new Date(input.now),
  });
  return payload;
}

// A proof's lifetime must be short, so a captured one is useless soon after.
export const boundedLifetime = (payload: { iat: number; exp: number }, nowMs: number, maxSeconds = 300) =>
  payload.exp > payload.iat && payload.exp - payload.iat <= maxSeconds && payload.exp * 1000 > nowMs && payload.iat * 1000 <= nowMs + 60_000;
