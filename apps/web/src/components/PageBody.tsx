import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { WorkspacePageContainer, type WorkspacePageWidth } from "./WorkspacePageContainer.tsx";

// The part of a page under its bar, as T3 Code's pages have it: it scrolls under the bar's fade, at
// the page's width and padding, so no page sets its own.
export function PageBody({ width = "readable", className, children }: { width?: WorkspacePageWidth; className?: string; children: ReactNode }) {
  return (
    <div className="topbar-scroll-fade min-h-0 flex-1 overflow-y-auto">
      <WorkspacePageContainer width={width} className={cn("text-[13px]", className)}>
        {children}
      </WorkspacePageContainer>
    </div>
  );
}
