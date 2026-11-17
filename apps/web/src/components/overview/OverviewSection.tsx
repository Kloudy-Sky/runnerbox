import type { ReactNode } from "react";

// One of Overview's sections: a small monospace title with a figure beside it, and space, not a
// box or a line, between it and the next.
export function OverviewSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <header className="flex items-baseline justify-between gap-2.5 pb-3">
        <h2 className="font-medium font-mono text-[11px] text-muted-foreground uppercase tracking-[0.09em]">{title}</h2>
        {aside ? <span className="truncate text-muted-foreground/75 text-xs">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}
