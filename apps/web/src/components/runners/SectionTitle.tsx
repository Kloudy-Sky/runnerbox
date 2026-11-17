import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

// A section's name in small monospace capitals, with a short note on its right.
export function SectionTitle({ children, note, noteClassName }: { children: ReactNode; note?: ReactNode; noteClassName?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-3">
      <h2 className="min-w-0 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.12em]">{children}</h2>
      {note ? <span className={cn("shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs", noteClassName)}>{note}</span> : null}
    </div>
  );
}
