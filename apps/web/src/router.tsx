import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.tsx";
import { parseSearch } from "./lib/search.ts";
import { HomePage } from "./pages/HomePage.tsx";
import { ItemPage } from "./pages/ItemPage.tsx";
import { RunnersPage } from "./pages/RunnersPage.tsx";
import { RunPage } from "./pages/RunPage.tsx";
import { RunsPage } from "./pages/RunsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { AboutSettings } from "./pages/settings/AboutSettings.tsx";
import { AccessSettings } from "./pages/settings/AccessSettings.tsx";
import { AccountsSettings } from "./pages/settings/AccountsSettings.tsx";
import { ChangesSettings } from "./pages/settings/ChangesSettings.tsx";
import { ConnectionsSettings } from "./pages/settings/ConnectionsSettings.tsx";
import { SpeedPage } from "./pages/SpeedPage.tsx";

// The time range and repo live in the URL, so a view can be reloaded or linked as it is.
const rootRoute = createRootRoute({ validateSearch: parseSearch, component: AppShell });

const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/item/$itemId", component: ItemPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs", component: RunsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs/$jobId", component: RunPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/speed", component: SpeedPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runners", component: RunnersPage }),
  settingsRoute.addChildren([
    createRoute({ getParentRoute: () => settingsRoute, path: "/", beforeLoad: () => { throw redirect({ to: "/settings/accounts", search: true }); } }),
    createRoute({ getParentRoute: () => settingsRoute, path: "/accounts", component: AccountsSettings }),
    createRoute({ getParentRoute: () => settingsRoute, path: "/connections", component: ConnectionsSettings }),
    createRoute({ getParentRoute: () => settingsRoute, path: "/access", component: AccessSettings }),
    createRoute({ getParentRoute: () => settingsRoute, path: "/changes", component: ChangesSettings }),
    createRoute({ getParentRoute: () => settingsRoute, path: "/about", component: AboutSettings }),
  ]),
  // Earlier names, so saved links still land somewhere.
  createRoute({ getParentRoute: () => rootRoute, path: "/inbox", beforeLoad: () => { throw redirect({ to: "/", search: true }); } }),
  createRoute({ getParentRoute: () => rootRoute, path: "/analytics", beforeLoad: () => { throw redirect({ to: "/speed", search: true }); } }),
  createRoute({ getParentRoute: () => rootRoute, path: "/connect", beforeLoad: () => { throw redirect({ to: "/settings/connections", search: true }); } }),
]);

// Hash history works the same from the Vite server, a browser, and the desktop app's bundled files.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
