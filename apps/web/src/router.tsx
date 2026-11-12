import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.tsx";
import { parseSearch } from "./lib/search.ts";
import { HomePage } from "./pages/HomePage.tsx";
import { ItemPage } from "./pages/ItemPage.tsx";
import { RunnersPage } from "./pages/RunnersPage.tsx";
import { RunPage } from "./pages/RunPage.tsx";
import { RunsPage } from "./pages/RunsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SpeedPage } from "./pages/SpeedPage.tsx";

// The time range and repo live in the URL, so a view can be reloaded or linked as it is.
const rootRoute = createRootRoute({ validateSearch: parseSearch, component: AppShell });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/item/$itemId", component: ItemPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs", component: RunsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs/$jobId", component: RunPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/speed", component: SpeedPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runners", component: RunnersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  // Earlier names, so saved links still land somewhere.
  createRoute({ getParentRoute: () => rootRoute, path: "/inbox", beforeLoad: () => { throw redirect({ to: "/", search: true }); } }),
  createRoute({ getParentRoute: () => rootRoute, path: "/analytics", beforeLoad: () => { throw redirect({ to: "/speed", search: true }); } }),
  createRoute({ getParentRoute: () => rootRoute, path: "/connect", beforeLoad: () => { throw redirect({ to: "/settings", search: true }); } }),
]);

// Hash history works the same from the Vite server, a browser, and the desktop app's bundled files.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
