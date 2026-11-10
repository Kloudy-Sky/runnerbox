import type { Route } from "@runnerbox/client-runtime";

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;

// How the switcher names a route: the transport, not the address.
export const routeKind = (route: Route) => (route.kind === "ssh" ? "ssh" : LOOPBACK.test(route.url) ? "loopback" : "direct");

export const routeAddress = (route: Route) => (route.kind === "ssh" ? route.host : route.url.replace(/^https?:\/\//, ""));
