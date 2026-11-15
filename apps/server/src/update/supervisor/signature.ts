import { createPublicKey, verify } from "node:crypto";

// A key releases are signed with: its Ed25519 public key as SPKI PEM, and a name to tell keys
// apart in release-keys.json while one replaces another.
export type ReleaseKey = { readonly id: string; readonly publicKey: string };

// What a release's signature covers: its version as well as its file, so a signed old release
// can't be served under a newer tag. The prefix keeps it from being taken for anything else the
// key could sign.
export const releaseMessage = (version: string, sha256: string) => `runnerbox-release:v1\n${version}\n${sha256}`;

// Whether `signature`, the base64 text of runnerbox.js.sig, is one of `keys` signing this version
// and checksum. A key that doesn't parse matches nothing.
export function verifyRelease(keys: ReadonlyArray<ReleaseKey>, version: string, sha256: string, signature: string) {
  const bytes = Buffer.from(signature.trim(), "base64");
  if (bytes.length !== 64) return false;
  const message = Buffer.from(releaseMessage(version, sha256));
  return keys.some((key) => {
    try {
      return verify(null, message, createPublicKey(key.publicKey), bytes);
    } catch {
      return false;
    }
  });
}
