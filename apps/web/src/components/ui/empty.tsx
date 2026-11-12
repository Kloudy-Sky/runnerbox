import type * as React from "react";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT): what a view says when it has nothing to show, as slots.
const Empty = {
  Root: ({ className, ...props }: React.ComponentProps<"div">) => (
    <div className={cn("flex max-w-[var(--reading-width)] flex-col gap-2 px-6 py-10", className)} data-slot="empty" {...props} />
  ),
  Title: ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("text-base font-medium", className)} data-slot="empty-title" {...props} />,
  Description: ({ className, ...props }: React.ComponentProps<"p">) => <p className={cn("text-muted-foreground", className)} data-slot="empty-description" {...props} />,
  Actions: ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("mt-2 flex gap-2", className)} data-slot="empty-actions" {...props} />,
};

export { Empty };
