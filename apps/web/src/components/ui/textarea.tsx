import type * as React from "react";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT). Grows with its content up to a limit, then scrolls.
type TextareaProps = React.ComponentProps<"textarea"> & { unstyled?: boolean };

function Textarea({ className, unstyled = false, ...props }: TextareaProps) {
  return (
    <span className={cn(!unstyled && "relative inline-flex w-full rounded-[var(--control-radius)] bg-input text-foreground ring-ring/40 transition-shadow has-focus-visible:ring-2", className)} data-slot="textarea-control">
      <textarea className="field-sizing-content max-h-64 min-h-16 w-full resize-none rounded-[inherit] bg-transparent px-2.5 py-1.5 outline-none placeholder:text-placeholder" data-slot="textarea" {...props} />
    </span>
  );
}

export { Textarea, type TextareaProps };
