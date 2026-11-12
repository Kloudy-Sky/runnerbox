import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { ConnectPage } from "../pages/ConnectPage.tsx";
import { runtime } from "../runtime.ts";
import { AppSidebar } from "./AppSidebar.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar.tsx";
import { ToastProvider } from "./ui/toast.tsx";
import { TooltipProvider } from "./ui/tooltip.tsx";

// T3 Code's layout: a sidebar of things with a status, and the selected one in the main column.
export function AppShell() {
  const loaded = useStore(runtime.store, (state) => state.loaded);
  const { environment } = useActiveEnvironment();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [commandOpen, setCommandOpen] = useState(false);
  // Cmd+K or Ctrl+K opens the palette from anywhere: a key press is outside React.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!loaded) return null;
  // Pairing comes first: without an environment there's nothing to put in the sidebar.
  if (!environment && !path.startsWith("/settings")) return <ConnectPage />;
  return (
    <TooltipProvider>
      <ToastProvider>
        <SidebarProvider>
          <AppSidebar onOpenCommand={() => setCommandOpen(true)} />
          <SidebarInset>
            <div className="flex h-10 shrink-0 items-center gap-2 px-2">
              <SidebarTrigger />
            </div>
            <ConnectionNotice />
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </ToastProvider>
    </TooltipProvider>
  );
}
