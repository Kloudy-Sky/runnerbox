import { Outlet, useRouterState } from "@tanstack/react-router";
import { useStore } from "zustand";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { ConnectPage } from "../pages/ConnectPage.tsx";
import { runtime } from "../runtime.ts";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { TopBar } from "./TopBar.tsx";

export function Layout() {
  const loaded = useStore(runtime.store, (state) => state.loaded);
  const { environment } = useActiveEnvironment();
  const path = useRouterState({ select: (state) => state.location.pathname });
  if (!loaded) return null;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <ConnectionNotice />
      <main className="min-h-0 flex-1 overflow-auto">{environment || path === "/connect" ? <Outlet /> : <ConnectPage />}</main>
    </div>
  );
}
