import type * as React from "react";
import { cn } from "../lib/utils.ts";

// The top of a browse view: its name, and its controls on the right.
export const PageHeader = {
  Root: ({ className, ...props }: React.ComponentProps<"header">) => <header className={cn("flex flex-wrap items-center gap-3 px-6 pt-6 pb-3", className)} data-slot="page-header" {...props} />,
  Title: ({ className, ...props }: React.ComponentProps<"h1">) => <h1 className={cn("text-lg font-medium", className)} data-slot="page-title" {...props} />,
  Spacer: () => <span className="flex-1" />,
};
