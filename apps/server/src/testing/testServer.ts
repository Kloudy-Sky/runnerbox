import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { AuthScope } from "@runnerbox/contracts";
import * as AuthStore from "../auth/AuthStore.ts";
import * as CloudLink from "../cloud/CloudLink.ts";
import * as Monitors from "../monitors/Monitors.ts";
import { layerApp } from "../server.ts";
import { makeFakeProvider } from "./FakeProvider.ts";
import { writeFixtures } from "./fixtures.ts";

// Tests never reach a real provider: a server without a scripted one has none available.
const makeFakeProviderUnavailable = () => makeFakeProvider({ turns: [], available: false });

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

// A real server on random loopback ports over freshly written fixture logs, in a temporary
// directory that `close` removes. Pass `stateDir` to start again over an earlier server's files,
// and `close(false)` to keep them. Threads use `provider`, or one that's never available.
export async function startTestServer(options: { fixtures?: boolean; stateDir?: string; provider?: ReturnType<typeof makeFakeProvider> } = {}) {
  const stateDir = options.stateDir ?? (await mkdtemp(join(tmpdir(), "runnerbox-server-test-")));
  const now = Date.now();
  if (options.stateDir === undefined && options.fixtures !== false) await writeFixtures(stateDir, now);
  const provider = options.provider ?? makeFakeProviderUnavailable();
  const scope = Effect.runSync(Scope.make());
  // Two loopback listeners on free ports: the one apps use, and the tunnel-facing one.
  const [port, tunnelPort] = [await freePort(), await freePort()];
  const context = await Effect.runPromise(Layer.buildWithScope(layerApp({ host: "127.0.0.1", port, tunnelPort, stateDir, provider: provider.layer }), scope));
  const auth = Context.get(context, AuthStore.AuthStore);
  const cloudLink = Context.get(context, CloudLink.CloudLink);
  const monitors = Context.get(context, Monitors.Monitors);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    // Where the relay's fake tunnel delivers, as `cloudflared` would.
    tunnelBaseUrl: `http://127.0.0.1:${tunnelPort}`,
    tunnelPort,
    cloudLink,
    // Runs a monitor pass now, instead of waiting for the next 15 minutes.
    checkMonitors: () => Effect.runPromise(monitors.check),
    auth,
    stateDir,
    now,
    createPairingCode: (scopes: ReadonlyArray<AuthScope>) => Effect.runPromise(auth.createPairingCode(scopes)),
    mintMcpToken: () => Effect.runPromise(auth.mintMcpToken("agent")).then(({ token }) => token),
    close: async (remove = true) => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      if (remove) await rm(stateDir, { recursive: true, force: true });
    },
  };
}
