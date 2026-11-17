import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { AuthScope, RpcMethod } from "@runnerbox/contracts";
import * as AuthStore from "../auth/AuthStore.ts";
import * as CloudLink from "../cloud/CloudLink.ts";
import * as ListeningPorts from "../config/ListeningPorts.ts";
import * as Monitors from "../monitors/Monitors.ts";
import * as ReviewWatch from "../reviews/ReviewWatch.ts";
import * as QueueConfig from "../runners/QueueConfig.ts";
import { layerApp, type UpdateWiring } from "../server.ts";
import { makeFakeProvider } from "./FakeProvider.ts";
import { writeFixtures } from "./fixtures.ts";

// Tests never reach a real provider: a server without a scripted one has none available.
const makeFakeProviderUnavailable = () => makeFakeProvider({ turns: [], available: false });

// A real server on random loopback ports over freshly written fixture logs, in a temporary
// directory that `close` removes. Pass `stateDir` to start again over an earlier server's files,
// and `close(false)` to keep them. Threads use `provider`, or one that's never available, and run
// Codex only when given `codex`. Updates use `updates`, or a build from a checkout that isn't
// supervised.
// Test servers never read a real report.env or reach GitHub unless a test says where.
const NO_QUEUE = { apiBase: "http://127.0.0.1:9", reportEnvPath: "/nonexistent/report.env", timing: { pollMs: 50, slowMs: 200, maxBackoffMs: 400, idleMs: 200, checkMs: 20 } };

export async function startTestServer(
  options: {
    fixtures?: boolean;
    stateDir?: string;
    provider?: ReturnType<typeof makeFakeProvider>;
    codex?: ReturnType<typeof makeFakeProvider>;
    withoutMethods?: ReadonlyArray<RpcMethod>;
    queue?: QueueConfig.QueueConfig["Service"];
    updates?: UpdateWiring;
    // Runs on the state directory before the server reads it.
    prepare?: (stateDir: string) => Promise<void>;
  } = {},
) {
  const stateDir = options.stateDir ?? (await mkdtemp(join(tmpdir(), "runnerbox-server-test-")));
  const now = Date.now();
  if (options.stateDir === undefined && options.fixtures !== false) await writeFixtures(stateDir, now);
  await options.prepare?.(stateDir);
  const provider = options.provider ?? makeFakeProviderUnavailable();
  const scope = Effect.runSync(Scope.make());
  // Two loopback listeners, the one apps use and the tunnel-facing one, each on a port the system
  // picks as it binds, so no other test can take it in between. Their ports are read back once up.
  const context = await Effect.runPromise(Layer.buildWithScope(layerApp({ host: "127.0.0.1", port: 0, tunnelPort: 0, stateDir, provider: provider.layer, ...(options.codex ? { codex: options.codex.codexLayer } : {}), withoutMethods: options.withoutMethods ?? [], queue: QueueConfig.layerTest(options.queue ?? NO_QUEUE), ...(options.updates ? { updates: options.updates } : {}) }), scope));
  const listening = Context.get(context, ListeningPorts.ListeningPorts);
  const [port, tunnelPort] = await Effect.runPromise(Effect.all([Deferred.await(listening.local), Deferred.await(listening.tunnel)]));
  const auth = Context.get(context, AuthStore.AuthStore);
  const cloudLink = Context.get(context, CloudLink.CloudLink);
  const monitors = Context.get(context, Monitors.Monitors);
  const reviewWatch = Context.get(context, ReviewWatch.ReviewWatch);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    // Where the relay's fake tunnel delivers, as `cloudflared` would.
    tunnelBaseUrl: `http://127.0.0.1:${tunnelPort}`,
    tunnelPort,
    cloudLink,
    // Runs a monitor pass now, instead of waiting for the next 15 minutes.
    checkMonitors: () => Effect.runPromise(monitors.check),
    // Runs the pass that reviews unasked now, instead of waiting for the next minute.
    checkReviews: () => Effect.runPromise(reviewWatch.check),
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
