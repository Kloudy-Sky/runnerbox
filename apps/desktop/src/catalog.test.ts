import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SavedEnvironment } from "@runnerbox/client-runtime";
import { createCatalog } from "./catalog.ts";
import { KeychainUnavailable } from "./sealSecret.ts";

const environment = (token: string | null): SavedEnvironment => ({
  environmentId: token ? "env-paired" : "env-connect",
  label: "example",
  routes: token ? [{ kind: "direct", url: "http://127.0.0.1:4517" }] : [{ kind: "connect", relayUrl: "https://relay.example.com" }],
  token,
  scopes: ["history:read"],
  pairedAt: new Date(0).toISOString(),
});

test("a token is never written in the clear: without a keychain it isn't saved at all", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runnerbox-catalog-"));
  try {
    const noKeychain = createCatalog(directory, { available: () => false, encrypt: (text) => text, decrypt: (text) => text });
    await assert.rejects(noKeychain.save(environment("rbx_secret")), KeychainUnavailable);
    assert.equal(await readFile(join(directory, "environments.json"), "utf8").catch(() => "missing"), "missing");
    // A Connect-only environment has no token, so it can still be saved.
    await noKeychain.save(environment(null));

    const keychain = createCatalog(directory, { available: () => true, encrypt: (text) => `sealed:${Buffer.from(text).toString("base64")}`, decrypt: (text) => Buffer.from(text.slice(7), "base64").toString() });
    await keychain.save(environment("rbx_secret"));
    const onDisk = await readFile(join(directory, "environments.json"), "utf8");
    assert.ok(!onDisk.includes("rbx_secret"));
    assert.deepEqual((await keychain.list()).map((saved) => saved.token), [null, "rbx_secret"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
