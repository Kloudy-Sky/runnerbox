import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as HttpServer from "effect/http/HttpServer";
import type { AuthScope } from "@runnerbox/contracts";
import * as AuthStore from "../auth/AuthStore.ts";
import * as CloudLink from "../cloud/CloudLink.ts";
import { layerApp } from "../server.ts";
import { writeFixtures } from "./fixtures.ts";

// A real server on a random loopback port over freshly written fixture logs, in a temporary
// directory that `close` removes.
export async function startTestServer({ fixtures = true } = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-server-test-"));
  const now = Date.now();
  if (fixtures) await writeFixtures(stateDir, now);
  const scope = Effect.runSync(Scope.make());
  const layer = layerApp(stateDir).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 })));
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag !== "InetAddressV4") throw new Error("expected a TCP address");
  const auth = Context.get(context, AuthStore.AuthStore);
  const cloudLink = Context.get(context, CloudLink.CloudLink);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    cloudLink,
    stateDir,
    now,
    createPairingCode: (scopes: ReadonlyArray<AuthScope>) => Effect.runPromise(auth.createPairingCode(scopes)),
    mintMcpToken: () => Effect.runPromise(auth.mintMcpToken("agent")).then(({ token }) => token),
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}
