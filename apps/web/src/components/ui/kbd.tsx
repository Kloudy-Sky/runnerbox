import type * as React from "react";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT).
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center rounded bg-foreground/[0.07] px-1 font-sans text-muted-foreground text-xs", className)}
      data-slot="kbd"
      {...props}
    />
  );
}

export { Kbd };
