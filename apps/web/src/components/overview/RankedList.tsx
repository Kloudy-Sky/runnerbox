import type { ReactNode } from "react";

export type RankedRow = { readonly key: string; readonly label: ReactNode; readonly value: ReactNode };

// The short list under a section's chart: a quiet heading, then a name and its figure per row.
export function RankedList({ heading, rows }: { heading: string; rows: ReadonlyArray<RankedRow> }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="pt-3.5 pb-0.5 text-muted-foreground/75 text-xs">{heading}</div>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-1 text-muted-foreground">
          <span className="truncate">{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
