import type * as React from "react";
import { cn } from "../../lib/utils.ts";

// One settings section, after T3 Code's settings panels: a title, a line on what it's for, then
// groups of rows, each a label, an optional line under it, and its control on the right. No card
// around groups: space separates them.
export const SettingsPanel = {
  Root: ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex w-full max-w-(--reading-width) flex-col gap-6 px-6 pt-8 pb-10", className)} data-slot="settings-panel" {...props} />,
  Header: ({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) => (
    <header className="flex flex-col gap-1" data-slot="settings-header">
      <h1 className="text-xl font-medium">{title}</h1>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
    </header>
  ),
  Group: ({ title, className, children, ...props }: React.ComponentProps<"section"> & { title?: React.ReactNode }) => (
    <section className={cn("flex flex-col gap-1", className)} data-slot="settings-group" {...props}>
      {title ? <h2 className="pb-1 text-muted-foreground text-xs">{title}</h2> : null}
      {children}
    </section>
  ),
  Row: ({ label, description, className, children, ...props }: React.ComponentProps<"div"> & { label: React.ReactNode; description?: React.ReactNode }) => (
    <div className={cn("flex min-h-10 items-center gap-4 py-1.5", className)} data-slot="settings-row" {...props}>
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        {description ? <div className="text-muted-foreground text-[13px]">{description}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  ),
  Notice: ({ className, ...props }: React.ComponentProps<"p">) => <p className={cn("text-muted-foreground", className)} data-slot="settings-notice" {...props} />,
};
