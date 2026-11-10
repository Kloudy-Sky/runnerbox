import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as AuthStore from "./auth/AuthStore.ts";
import * as CloudLink from "./cloud/CloudLink.ts";
import * as Connector from "./cloud/connector.ts";
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

export type ServeOptions = { readonly host: string; readonly port: number; readonly stateDir: string; readonly label?: string };

// Every service, shared by the RPC socket and, later, MCP. Built outside `HttpRouter.serve` so all
// routes see the same instances.
export const layerServices = (stateDir: string, label?: string) =>
  Layer.mergeAll(JobHistory.layer, LauncherLogs.layer, Inbox.layer, CloudLink.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(StateLogs.layer, RunnerState.layer)),
    Layer.provideMerge(Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(label))),
    Layer.provideMerge(ServerPaths.layer(stateDir)),
    Layer.provideMerge(NodeServices.layer),
  );

export const layerRoutes = Layer.mergeAll(Routes.layer, ConnectRoutes.layer, Ws.layer, Mcp.layer);

const served = () => HttpRouter.serve(layerRoutes, { disableLogger: true, disableListenLog: true });

// The served routes over the shared services, exposing both so tests can mint codes on the same
// instance. Needs an `HttpServer`.
export const layerApp = (stateDir: string, label?: string) => served().pipe(Layer.provideMerge(layerServices(stateDir, label)));

// The served app plus, for a linked environment, its tunnel connector, over one set of services.
export const layerServer = ({ host, port, stateDir, label }: ServeOptions) =>
  Layer.merge(served(), Connector.layer).pipe(
    Layer.provide(layerServices(stateDir, label)),
    // Open sockets would hold a graceful shutdown open, and nothing here has work to finish.
    Layer.provide(NodeHttpServer.layer(createServer, { host, port, gracefulShutdownTimeout: "1 second" })),
  );
