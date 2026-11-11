import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createConnect } from "./connect.ts";
import { KeychainUnavailable } from "./sealSecret.ts";

test("a sign-in that can't be saved without a keychain isn't held either", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runnerbox-connect-"));
  // Stands in for the relay's config and Clerk's token endpoint.
  const stub = createServer((request, response) => {
    const base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    if (request.url === "/v1/config") return void response.end(JSON.stringify({ relayIssuer: base, clerkFrontendApi: base, cliClientId: "cli", desktopClientId: "desktop" }));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ access_token: "clerk_access", refresh_token: "clerk_refresh", expires_in: 3600 }));
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  try {
    const relayUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    // The "browser" follows the authorize URL straight back to the app's redirect.
    const openBrowser = (url: string) => {
      const authorize = new URL(url);
      void fetch(`${authorize.searchParams.get("redirect_uri")}?code=abc&state=${authorize.searchParams.get("state")}`);
    };
    const connect = createConnect(directory, { available: () => false, encrypt: (text) => text, decrypt: (text) => text }, openBrowser);
    await assert.rejects(connect.signIn(relayUrl), KeychainUnavailable);
    assert.deepEqual(await connect.status(), { relayUrl: null, signedIn: false });
    assert.equal(await readFile(join(directory, "connect.json"), "utf8").catch(() => "missing"), "missing");
  } finally {
    stub.close();
    await rm(directory, { recursive: true, force: true });
  }
});
