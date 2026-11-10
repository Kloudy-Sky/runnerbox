import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as AuthStore from "./auth/AuthStore.ts";
import * as ServerPaths from "./config/ServerPaths.ts";
import * as EnvironmentIdentity from "./environment/EnvironmentIdentity.ts";
import * as JobHistory from "./history/JobHistory.ts";
import * as StateLogs from "./history/StateLogs.ts";
import * as Routes from "./http/routes.ts";
import * as Mcp from "./mcp/route.ts";
import * as Inbox from "./inbox/Inbox.ts";
import * as Ws from "./rpc/ws.ts";
import * as LauncherLogs from "./runners/LauncherLogs.ts";
import * as RunnerState from "./runners/RunnerState.ts";

export type ServeOptions = { readonly host: string; readonly port: number; readonly stateDir: string; readonly label?: string };

// Every service, shared by the RPC socket and, later, MCP. Built outside `HttpRouter.serve` so all
// routes see the same instances.
export const layerServices = (stateDir: string, label?: string) =>
  Layer.mergeAll(JobHistory.layer, LauncherLogs.layer, Inbox.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(StateLogs.layer, RunnerState.layer)),
    Layer.provideMerge(Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(label))),
    Layer.provideMerge(ServerPaths.layer(stateDir)),
    Layer.provideMerge(NodeServices.layer),
  );

export const layerRoutes = Layer.mergeAll(Routes.layer, Ws.layer, Mcp.layer);

// The served routes over the shared services, exposing both so tests can mint codes on the same
// instance. Needs an `HttpServer`.
export const layerApp = (stateDir: string, label?: string) =>
  HttpRouter.serve(layerRoutes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(layerServices(stateDir, label)),
  );

export const layerServer = ({ host, port, stateDir, label }: ServeOptions) =>
  // Open sockets would hold a graceful shutdown open, and nothing here has work to finish.
  layerApp(stateDir, label).pipe(Layer.provide(NodeHttpServer.layer(createServer, { host, port, gracefulShutdownTimeout: "1 second" })));
