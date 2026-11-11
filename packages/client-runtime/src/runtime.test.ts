import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { DESCRIPTOR_PATH, PROTOCOL_VERSION } from "@runnerbox/contracts";
import type { SavedEnvironment } from "./environments.ts";
import { createClientRuntime } from "./runtime.ts";

test("an address that answers as another environment never receives the saved token", async () => {
  const seen: string[] = [];
  const impostor = createServer((request, response) => {
    seen.push(`${request.method} ${request.url} ${request.headers.authorization ?? ""}`);
    if (request.url === DESCRIPTOR_PATH) {
      response.end(JSON.stringify({ environmentId: "someone-else", label: "example", serverVersion: "0", protocolVersion: PROTOCOL_VERSION }));
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => impostor.listen(0, "127.0.0.1", resolve));
  const { port } = impostor.address() as AddressInfo;
  const saved: SavedEnvironment = {
    environmentId: "paired-one",
    label: "example",
    routes: [{ kind: "direct", url: `http://127.0.0.1:${port}` }],
    token: "rbx_secret",
    scopes: ["history:read"],
    pairedAt: new Date(0).toISOString(),
  };
  const runtime = createClientRuntime({ catalog: { list: async () => [saved], save: async () => {}, remove: async () => {} } });
  await runtime.load();
  const state = await new Promise((resolve) => {
    const unsubscribe = runtime.store.subscribe((current) => {
      const connection = current.connections["paired-one"];
      if (connection?.status === "disconnected") {
        unsubscribe();
        resolve(connection);
      }
    });
  });
  impostor.close();
  assert.equal((state as { reason: string }).reason, "wrong_environment");
  assert.deepEqual(seen, [`GET ${DESCRIPTOR_PATH} `]);
});

test("a Connect route signs with the platform's proof key, so the renderer needs no WebCrypto of its own", async () => {
  const pairProofs: string[] = [];
  const environment = createServer((request, response) => {
    if (request.url === "/api/auth/pair") pairProofs.push(String(request.headers.dpop ?? ""));
    // Refusing ends the attempt; what matters is what was sent.
    response.statusCode = 401;
    response.end("{}");
  });
  await new Promise<void>((resolve) => environment.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(environment.address() as AddressInfo).port}`;
  const asked: string[] = [];
  const signed: string[] = [];
  const runtime = createClientRuntime({
    catalog: { list: async () => [], save: async () => {}, remove: async () => {} },
    connect: {
      status: async () => ({ relayUrl: "https://relay.example.com", signedIn: true }),
      signIn: async () => {},
      signOut: async () => {},
      environments: async () => [],
      createProofKey: async () => ({ keyId: "key-1", thumbprint: "thumbprint-from-platform" }),
      prove: async (keyId, request) => {
        signed.push(`${keyId} ${request.method} ${new URL(request.url).pathname}`);
        return `proof-from-${keyId}`;
      },
      requestCredential: async (environmentId, thumbprint) => {
        asked.push(thumbprint);
        return { environmentId, httpBaseUrl: baseUrl, credential: "AAAAA-BBBBB-CCCCC-DDDDD", expiresAt: new Date(Date.now() + 60_000).toISOString() };
      },
    },
  });
  await runtime.addConnectRoute({ environmentId: "env-1", label: "example" }, "https://relay.example.com");
  await new Promise<void>((resolve) => {
    const unsubscribe = runtime.store.subscribe((state) => {
      if (state.connections["env-1"]?.status !== "disconnected") return;
      unsubscribe();
      resolve();
    });
  });
  await runtime.remove("env-1");
  environment.close();
  assert.deepEqual(asked, ["thumbprint-from-platform"]);
  assert.deepEqual(signed, ["key-1 POST /api/auth/pair"]);
  assert.deepEqual(pairProofs, ["proof-from-key-1"]);
});
