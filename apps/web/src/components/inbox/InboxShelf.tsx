import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";

// A fold under the rows that need the owner, after T3 Code's Settled shelf: its name and count,
// closed until opened. Left out when it holds nothing.
export function InboxShelf({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md px-2.5 py-1 text-left text-muted-foreground text-xs hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        {label} · {count}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="flex flex-col gap-0.5">{children}</ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
