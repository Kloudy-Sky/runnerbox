import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as AuthStore from "./auth/AuthStore.ts";
import * as CloudLink from "./cloud/CloudLink.ts";
import * as Connector from "./cloud/connector.ts";
import * as LocalEndpoint from "./config/LocalEndpoint.ts";
import * as ServerPaths from "./config/ServerPaths.ts";
import * as EnvironmentIdentity from "./environment/EnvironmentIdentity.ts";
import * as JobHistory from "./history/JobHistory.ts";
import * as StateLogs from "./history/StateLogs.ts";
import * as ConnectRoutes from "./http/connectRoutes.ts";
import * as Routes from "./http/routes.ts";
import * as Mcp from "./mcp/route.ts";
import * as Inbox from "./inbox/Inbox.ts";
import * as Ws from "./rpc/ws.ts";
import * as LauncherLogs from "./runners/LauncherLogs.ts";
import * as RunnerState from "./runners/RunnerState.ts";
import * as ClaudeAdapter from "./threads/provider/ClaudeAdapter.ts";
import type { ProviderAdapter } from "./threads/provider/ProviderAdapter.ts";
import * as Proposals from "./proposals/Proposals.ts";
import * as Reproduces from "./reproduce/Reproduces.ts";
import * as UpSocket from "./reproduce/UpSocket.ts";
import * as Threads from "./threads/Threads.ts";
import * as AccountStore from "./accounts/AccountStore.ts";
import * as Drivers from "./threads/provider/Drivers.ts";

export type ServeOptions = { readonly host: string; readonly port: number; readonly stateDir: string; readonly label?: string };

// Which agent provider threads use. Tests swap in a scripted one.
type Provider = Layer.Layer<ProviderAdapter, never, ServerPaths.ServerPaths>;

// Every service, shared by the RPC socket and MCP. Built outside `HttpRouter.serve` so all routes
// see the same instances.
export const layerServices = (input: { stateDir: string; host: string; port: number; label?: string | undefined; provider?: Provider | undefined }) =>
  Threads.layer.pipe(
    Layer.provideMerge(AccountStore.layer),
    Layer.provideMerge(Drivers.layer),
    Layer.provideMerge(Layer.mergeAll(Reproduces.layer, Proposals.layer).pipe(Layer.provideMerge(UpSocket.layer))),
    Layer.provide(input.provider ?? ClaudeAdapter.layer),
    Layer.provide(LocalEndpoint.layer(input.host, input.port)),
    Layer.provideMerge(Layer.mergeAll(JobHistory.layer, LauncherLogs.layer, Inbox.layer, CloudLink.layer)),
    Layer.provideMerge(Layer.mergeAll(StateLogs.layer, RunnerState.layer)),
    Layer.provideMerge(Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(input.label))),
    Layer.provideMerge(ServerPaths.layer(input.stateDir)),
    Layer.provideMerge(NodeServices.layer),
  );

// What each listener serves. The loopback one serves everything. The tunnel one, which only
// `cloudflared` points at, serves the relay's Connect requests and what a Connect session needs,
// and nothing that takes a CLI pairing code, an app session or an MCP token.
const layerLocalRoutes = Layer.mergeAll(Routes.layer("local"), Ws.layer("local"), Mcp.layer);
const layerTunnelRoutes = Layer.mergeAll(Routes.layer("tunnel"), ConnectRoutes.layer, Ws.layer("tunnel"));
const serveOptions = { disableLogger: true, disableListenLog: true } as const;

const listener = (host: string, port: number) =>
  // Open sockets would hold a graceful shutdown open, and nothing here has work to finish.
  NodeHttpServer.layer(createServer, { host, port, gracefulShutdownTimeout: "1 second" });

// Both listeners. The tunnel listener always binds loopback, and only exists when linked.
const layerListeners = (input: { host: string; port: number; tunnelPort: number | null }) =>
  Layer.mergeAll(
    HttpRouter.serve(layerLocalRoutes, serveOptions).pipe(Layer.provide(listener(input.host, input.port))),
    input.tunnelPort === null ? Layer.empty : HttpRouter.serve(layerTunnelRoutes, serveOptions).pipe(Layer.provide(listener("127.0.0.1", input.tunnelPort))),
  );

// The listeners over the shared services, exposing the services so tests can mint codes on the
// same instance.
export const layerApp = (input: { host: string; port: number; tunnelPort: number | null; stateDir: string; label?: string; provider?: Provider }) =>
  layerListeners(input).pipe(Layer.provideMerge(layerServices(input)));

// `serve`: the listeners, with the tunnel one on the port the link chose, and for a linked
// environment its connector, all over one set of services.
export const layerServer = ({ host, port, stateDir, label }: ServeOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const link = yield* CloudLink.CloudLink;
      const state = yield* link.state.pipe(Effect.orElseSucceed(() => null));
      return Layer.merge(layerListeners({ host, port, tunnelPort: state?.tunnelPort ?? null }), Connector.layer);
    }),
  ).pipe(Layer.provide(layerServices({ stateDir, host, port, label })));
