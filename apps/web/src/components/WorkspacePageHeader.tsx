import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";

// runnerbox: the sidebar folds to a rail instead of away, so the bar needs no room for a toggle
// floating over it, and the desktop shell keeps the system's title bar, so there's no drag region
// or native controls to keep clear of.
export function WorkspacePageHeader({ className, ...props }: ComponentPropsWithoutRef<"header">) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)]! min-h-[var(--workspace-topbar-height)]! max-h-[var(--workspace-topbar-height)]! shrink-0 items-center gap-3 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left,padding-right] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        className,
      )}
      {...props}
    />
  );
}
