import type { ConnectionState, Route, SavedEnvironment } from "@runnerbox/client-runtime";

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;

// How the switcher names a route: the transport, not the address.
export const routeKind = (route: Route) =>
  route.kind === "ssh" ? "ssh" : route.kind === "connect" ? "connect" : LOOPBACK.test(route.url) ? "loopback" : "direct";

// How a connection reached the environment, in words: "this machine", "over SSH".
export const routePhrase = (route: Route) =>
  ({ ssh: "over SSH", connect: "through Connect", loopback: "this machine", direct: "by address" })[routeKind(route)];

export const routeAddress = (route: Route) =>
  route.kind === "ssh" ? route.host : route.kind === "connect" ? new URL(route.relayUrl).host : route.url.replace(/^https?:\/\//, "");

// The route a connection is using, or the first it will try.
export const activeRoute = (environment: SavedEnvironment, connection: ConnectionState | undefined) =>
  connection?.status === "connected" ? connection.route : environment.routes[0];
