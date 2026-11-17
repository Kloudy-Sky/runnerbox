import type { ReactNode } from "react";

// One of Speed and cost's questions: a small monospace title, a note on the right saying what it
// counts over, and its answer under them.
export function Section({ title, note, children }: { readonly title: string; readonly note?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="font-mono text-[11px] tracking-[0.12em] text-foreground/80 uppercase">{title}</h2>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}
