import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { RpcMethod } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as Deferred from "effect/Deferred";
import * as Attachments from "./attachments/Attachments.ts";
import * as AuthStore from "./auth/AuthStore.ts";
import * as CloudLink from "./cloud/CloudLink.ts";
import * as Connector from "./cloud/connector.ts";
import * as ListeningPorts from "./config/ListeningPorts.ts";
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
import * as QueueConfig from "./runners/QueueConfig.ts";
import * as RunnerQueue from "./runners/RunnerQueue.ts";
import * as RunnerState from "./runners/RunnerState.ts";
import * as ToolReleases from "./runners/ToolReleases.ts";
import * as ClaudeAdapter from "./threads/provider/ClaudeAdapter.ts";
import * as CodexAdapter from "./threads/provider/CodexAdapter.ts";
import type { CodexProviderAdapter, ProviderAdapter } from "./threads/provider/ProviderAdapter.ts";
import * as Monitors from "./monitors/Monitors.ts";
import * as Proposals from "./proposals/Proposals.ts";
import * as Reproduces from "./reproduce/Reproduces.ts";
import * as UpSocket from "./reproduce/UpSocket.ts";
import * as Threads from "./threads/Threads.ts";
import * as AccountStore from "./accounts/AccountStore.ts";
import * as Providers from "./accounts/Providers.ts";
import * as Drivers from "./threads/provider/Drivers.ts";

export type ServeOptions = { readonly host: string; readonly port: number; readonly stateDir: string; readonly label?: string; readonly codex?: boolean };

// Which agent provider threads use. Tests swap in a scripted one.
type Provider = Layer.Layer<ProviderAdapter, never, ServerPaths.ServerPaths>;
// Codex's, given only to a server that runs Codex.
type CodexProvider = Layer.Layer<CodexProviderAdapter, never, ServerPaths.ServerPaths>;

type ServicesInput = {
  stateDir: string;
  host: string;
  port: number;
  tunnelPort?: number | null | undefined;
  label?: string | undefined;
  provider?: Provider | undefined;
  codex?: CodexProvider | undefined;
  // Only tests replace where the queue poll sends requests and reads its token.
  queue?: Layer.Layer<QueueConfig.QueueConfig> | undefined;
};

// Every service, shared by the RPC socket and MCP. Built outside `HttpRouter.serve` so all routes
// see the same instances.
export const layerServices = (input: ServicesInput) => Monitors.layer.pipe(Layer.provideMerge(layerCore(input)));

// Everything but the monitor, which sits on top so a test can run it on a fake clock.
export const layerCore = (input: ServicesInput) =>
  Layer.mergeAll(Threads.layer, Providers.layer).pipe(
    Layer.provideMerge(AccountStore.layer),
    Layer.provideMerge(Drivers.layer),
    Layer.provideMerge(Layer.mergeAll(Reproduces.layer, Proposals.layer, Attachments.layer).pipe(Layer.provideMerge(UpSocket.layer))),
    Layer.provide(input.provider ?? ClaudeAdapter.layer),
    Layer.provide(input.codex ?? Layer.empty),
    Layer.provide(LocalEndpoint.layer(input.host)),
    Layer.provideMerge(Layer.mergeAll(JobHistory.layer, LauncherLogs.layer, Inbox.layer, CloudLink.layer, RunnerQueue.layer)),
    Layer.provideMerge(Layer.mergeAll(StateLogs.layer, RunnerState.layer)),
    Layer.provideMerge(ToolReleases.layer.pipe(Layer.provideMerge(input.queue ?? QueueConfig.layer))),
    Layer.provideMerge(Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(input.label))),
    Layer.provideMerge(ServerPaths.layer(input.stateDir)),
    Layer.provideMerge(ListeningPorts.layer({ port: input.port, tunnelPort: input.tunnelPort ?? null })),
    Layer.provideMerge(NodeServices.layer),
  );

// What each listener serves. The loopback one serves everything. The tunnel one, which only
// `cloudflared` points at, serves the relay's Connect requests and what a Connect session needs,
// and nothing that takes a CLI pairing code, an app session or an MCP token.
const layerLocalRoutes = (without: ReadonlyArray<RpcMethod>) => Layer.mergeAll(Routes.layer("local"), Ws.layer("local", without), Mcp.layer);
const layerTunnelRoutes = (without: ReadonlyArray<RpcMethod>) => Layer.mergeAll(Routes.layer("tunnel"), ConnectRoutes.layer, Ws.layer("tunnel", without));
const serveOptions = { disableLogger: true, disableListenLog: true } as const;

// No client message is anywhere near this: attachments arrive in chunks of 512 KB. `ws` would
// otherwise take one of up to 100 MB from any socket with a ticket.
const MAX_SOCKET_MESSAGE_BYTES = 4 * 1024 * 1024;

const listener = (host: string, port: number) =>
  // Open sockets would hold a graceful shutdown open, and nothing here has work to finish.
  NodeHttpServer.layer(createServer, { host, port, gracefulShutdownTimeout: "1 second", websocket: { maxPayload: MAX_SOCKET_MESSAGE_BYTES } });

// Serves `routes` on a listener and records the port it bound, which is the system's choice when
// asked for 0.
const serveOn = <E, R>(routes: Layer.Layer<never, E, R>, host: string, port: number, which: "local" | "tunnel") =>
  Layer.merge(
    HttpRouter.serve(routes, serveOptions),
    Layer.effectDiscard(
      Effect.gen(function* () {
        const { address } = yield* HttpServer.HttpServer;
        const ports = yield* ListeningPorts.ListeningPorts;
        if ("port" in address) yield* Deferred.succeed(ports[which], address.port);
      }),
    ),
  ).pipe(Layer.provide(listener(host, port)));

// Both listeners. The tunnel listener always binds loopback, and only exists when linked.
const layerListeners = (input: { host: string; port: number; tunnelPort: number | null; withoutMethods?: ReadonlyArray<RpcMethod> | undefined }) =>
  Layer.mergeAll(
    serveOn(layerLocalRoutes(input.withoutMethods ?? []), input.host, input.port, "local"),
    input.tunnelPort === null ? Layer.empty : serveOn(layerTunnelRoutes(input.withoutMethods ?? []), "127.0.0.1", input.tunnelPort, "tunnel"),
  );

// The listeners over the shared services, exposing the services so tests can mint codes on the
// same instance.
// `withoutMethods` serves the RPC as a build older than those methods would, for tests and the fake server.
export const layerApp = (input: {
  host: string;
  port: number;
  tunnelPort: number | null;
  stateDir: string;
  label?: string;
  provider?: Provider;
  codex?: CodexProvider;
  withoutMethods?: ReadonlyArray<RpcMethod>;
  queue?: Layer.Layer<QueueConfig.QueueConfig>;
}) =>
  layerListeners(input).pipe(Layer.provideMerge(layerServices(input)));

// `serve`: the listeners, with the tunnel one on the port the link chose, and for a linked
// environment its connector, all over one set of services.
export const layerServer = ({ host, port, stateDir, label, codex }: ServeOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const link = yield* CloudLink.CloudLink;
      const state = yield* link.state.pipe(Effect.orElseSucceed(() => null));
      return Layer.merge(layerListeners({ host, port, tunnelPort: state?.tunnelPort ?? null }), Connector.layer);
    }),
  ).pipe(Layer.provide(layerServices({ stateDir, host, port, label, codex: codex ? CodexAdapter.layer : undefined })));
