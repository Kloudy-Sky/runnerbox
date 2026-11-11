import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProof, createProofKey, type ProofKey } from "@runnerbox/connect/dpop";
import { clerkEndpoints, loopbackAuthorize, refreshTokens, type Tokens } from "@runnerbox/connect/oauth";
import { relayClient } from "@runnerbox/connect/relay";
import * as Schema from "effect/Schema";
import type { TokenCipher } from "./catalog.ts";
import { sealSecret } from "./sealSecret.ts";

// The desktop app's Runnerbox Connect sign-in. Main holds the Clerk tokens, encrypted at rest, and
// makes every relay call; the renderer only ever gets a one-time credential bound to its own key.

type Saved = { relayUrl: string; tokens: Tokens };

// Each connection makes a key and needs it only while that connection lasts, so a few recent ones
// are kept and older ones dropped, which also bounds a reconnect loop.
const PROOF_KEYS_KEPT = 16;

const StoredFile = Schema.fromJsonString(Schema.Struct({ relayUrl: Schema.String, tokens: Schema.String, encrypted: Schema.Boolean }));
const StoredTokens = Schema.fromJsonString(Schema.Struct({ accessToken: Schema.String, refreshToken: Schema.NullOr(Schema.String), expiresAt: Schema.Number }));
const decodeFile = Schema.decodeUnknownSync(StoredFile);
const decodeTokens = Schema.decodeUnknownSync(StoredTokens);

export function createConnect(directory: string, cipher: TokenCipher, openBrowser: (url: string) => void) {
  const path = join(directory, "connect.json");
  let cached: Saved | null | undefined;
  const proofKeys = new Map<string, ProofKey>();

  async function load() {
    if (cached !== undefined) return cached;
    const text = await readFile(path, "utf8").catch(() => "");
    try {
      const stored = decodeFile(text);
      cached = { relayUrl: stored.relayUrl, tokens: decodeTokens(stored.encrypted ? cipher.decrypt(stored.tokens) : stored.tokens) };
    } catch {
      cached = null;
    }
    return cached;
  }

  async function store(saved: Saved | null) {
    if (!saved) {
      cached = null;
      return rm(path, { force: true });
    }
    // Sealed first: a sign-in that can't be saved isn't held in memory either.
    const tokens = sealSecret(cipher, JSON.stringify(saved.tokens));
    cached = saved;
    await writeFile(`${path}.tmp`, JSON.stringify({ relayUrl: saved.relayUrl, tokens, encrypted: true }), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }

  // A current access token, refreshed a minute before it expires.
  async function accessToken() {
    const saved = await load();
    if (!saved) throw new Error("Sign in to Runnerbox Connect first.");
    if (saved.tokens.expiresAt - Date.now() > 60_000) return { relayUrl: saved.relayUrl, token: saved.tokens.accessToken };
    if (!saved.tokens.refreshToken) throw new Error("Your Runnerbox Connect sign-in expired. Sign in again.");
    const config = await relayClient(saved.relayUrl).config();
    const tokens = await refreshTokens({ endpoints: clerkEndpoints(config.clerkFrontendApi), clientId: config.desktopClientId, refreshToken: saved.tokens.refreshToken });
    await store({ relayUrl: saved.relayUrl, tokens });
    return { relayUrl: saved.relayUrl, token: tokens.accessToken };
  }

  return {
    async status() {
      const saved = await load();
      return { relayUrl: saved?.relayUrl ?? null, signedIn: saved !== null };
    },
    async signIn(relayUrl: string) {
      const config = await relayClient(relayUrl).config();
      const tokens = await loopbackAuthorize({ endpoints: clerkEndpoints(config.clerkFrontendApi), clientId: config.desktopClientId, openBrowser });
      await store({ relayUrl, tokens });
    },
    signOut: () => store(null),
    async environments() {
      const { relayUrl, token } = await accessToken();
      return relayClient(relayUrl).environments(token);
    },
    // Proof keys live here, in main: they can't be exported, and the renderer has no WebCrypto.
    async createProofKey() {
      const key = await createProofKey();
      const keyId = crypto.randomUUID();
      proofKeys.set(keyId, key);
      for (const old of [...proofKeys.keys()].slice(0, Math.max(0, proofKeys.size - PROOF_KEYS_KEPT))) proofKeys.delete(old);
      return { keyId, thumbprint: key.thumbprint };
    },
    prove(keyId: string, request: { method: string; url: string }) {
      const key = proofKeys.get(keyId);
      if (!key) throw new Error("That proof key is gone. Reconnect to make a new one.");
      return createProof(key, request);
    },
    async requestCredential(environmentId: string, clientProofKeyThumbprint: string) {
      const { relayUrl, token } = await accessToken();
      return relayClient(relayUrl).connect(token, environmentId, clientProofKeyThumbprint);
    },
  };
}
