import { createPrivateKey, createSign } from "node:crypto";

const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

// The token a GitHub App proves itself with, signed with its private key. GitHub takes one that
// lasts at most 10 minutes; this lasts 9 and starts a minute back, for a clock that runs ahead.
// Null when `privateKey` isn't an RSA private key.
export function appJwt(appId: string, privateKey: string, nowMs: number): string | null {
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa") return null;
    const seconds = Math.floor(nowMs / 1000);
    const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: seconds - 60, exp: seconds + 540, iss: appId })}`;
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key).toString("base64url")}`;
  } catch {
    return null;
  }
}
