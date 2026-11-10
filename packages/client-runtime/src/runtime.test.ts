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
    route: { kind: "direct", url: `http://127.0.0.1:${port}` },
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
