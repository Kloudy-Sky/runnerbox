// release-keys.json: the public keys release signatures are checked against, written into
// runnerbox.js by scripts/build.ts. Each is { "id": "...", "publicKey": "-----BEGIN PUBLIC KEY-----..." }.
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ReleaseKey } from "../apps/server/src/update/supervisor/signature.ts";

const ID = /^[A-Za-z0-9._-]{1,40}$/;

// Fails on anything but a list of named Ed25519 public keys, so a bad paste stops the build.
export function readReleaseKeys(path = "release-keys.json"): ReadonlyArray<ReleaseKey> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const keys: ReadonlyArray<unknown> | null = typeof parsed === "object" && parsed !== null && "keys" in parsed && Array.isArray(parsed.keys) ? parsed.keys : null;
  if (keys === null) throw new Error(`${path} isn't { "keys": [...] }.`);
  return keys.map((key, index) => {
    if (typeof key !== "object" || key === null || !("id" in key) || !("publicKey" in key) || typeof key.id !== "string" || typeof key.publicKey !== "string" || !ID.test(key.id)) {
      throw new Error(`${path}: key ${index} needs an "id" of letters, digits, dots, dashes or underscores, and a "publicKey".`);
    }
    if (createPublicKey(key.publicKey).asymmetricKeyType !== "ed25519") throw new Error(`${path}: key ${key.id} isn't an Ed25519 public key.`);
    return { id: key.id, publicKey: key.publicKey };
  });
}
