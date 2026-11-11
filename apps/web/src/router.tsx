import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "./components/Layout.tsx";
import { parseSearch } from "./lib/search.ts";
import { AnalyticsPage } from "./pages/AnalyticsPage.tsx";
import { ConnectPage } from "./pages/ConnectPage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { RunnersPage } from "./pages/RunnersPage.tsx";
import { RunsPage } from "./pages/RunsPage.tsx";


// The time range and repo live in the URL, so a view can be reloaded or linked as it is.
const rootRoute = createRootRoute({
  validateSearch: parseSearch,
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/inbox", search: true });
  },
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  createRoute({ getParentRoute: () => rootRoute, path: "/inbox", component: InboxPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs", component: RunsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/analytics", component: AnalyticsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runners", component: RunnersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/connect", component: ConnectPage }),
]);

// Hash history works the same from the Vite server, a browser, and the desktop app's bundled files.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
