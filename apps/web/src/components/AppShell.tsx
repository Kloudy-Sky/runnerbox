import { Outlet, useRouterState } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useState } from "react";
import { useStore } from "zustand";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { useNeedsYouNotifications } from "../hooks/useNeedsYouNotifications.ts";
import { ConnectPage } from "../pages/ConnectPage.tsx";
import { PanelAnimationSuppressionProvider, usePanelAnimationSettings, usePanelNavigationSuppression } from "../panelAnimations.ts";
import { runtime } from "../runtime.ts";
import { AppSidebar } from "./AppSidebar.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { RangePicker } from "./RangePicker.tsx";
import { Button } from "./ui/button.tsx";
import { Kbd } from "./ui/kbd.tsx";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar.tsx";
import { ToastProvider } from "./ui/toast.tsx";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

// T3 Code's layout: a sidebar of pages that narrows to a rail, and the open page in the main column.
export function AppShell() {
  const loaded = useStore(runtime.store, (state) => state.loaded);
  const { environment } = useActiveEnvironment();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [commandOpen, setCommandOpen] = useState(false);
  // As T3 Code's AppSidebarLayout: the sidebar eases open and shut, except under reduced motion
  // and for the two frames after a route change, so a new page never animates in.
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } = usePanelAnimationSettings();
  const panelAnimationsSuppressed = usePanelNavigationSuppression(path);
  useNeedsYouNotifications();
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
        {/* Held to the window, so a long thread scrolls inside its column and the composer stays in view. */}
        <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
          <SidebarProvider
            className="h-svh"
            data-panel-animations={panelAnimationsActive && !panelAnimationsSuppressed ? "true" : "false"}
            storageKey="runnerbox_sidebar_open"
            style={{ "--panel-animation-duration": `${panelAnimationDurationMs}ms` } as CSSProperties}
          >
            <AppSidebar />
            <SidebarInset>
              <div className="flex h-10 shrink-0 items-center gap-2 px-2">
                <Tooltip>
                  <TooltipTrigger render={<SidebarTrigger aria-label="Toggle sidebar" />} />
                  <TooltipPopup side="bottom">Toggle sidebar (⌘B)</TooltipPopup>
                </Tooltip>
                <div className="ml-auto flex items-center gap-1">
                  {/* Overview has its own range beside its machine filter. */}
                  {path !== "/" ? <RangePicker /> : null}
                  <Button variant="ghost-muted" size="xs" onClick={() => setCommandOpen(true)} aria-label="Jump to a page, item or run" title="Jump to a page, item or run">
                    <Kbd>⌘K</Kbd>
                  </Button>
                </div>
              </div>
              <ConnectionNotice />
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        </PanelAnimationSuppressionProvider>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </ToastProvider>
    </TooltipProvider>
  );
}
