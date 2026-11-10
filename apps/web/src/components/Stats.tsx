import type { ReactNode } from "react";

export function Stats({ items }: { items: ReadonlyArray<readonly [ReactNode, string]> }) {
  return (
    <div className="flex flex-wrap gap-x-7 gap-y-2 px-3 pt-2 pb-3">
      {items.map(([value, label]) => (
        <div key={label}>
          <div className="text-[18px] tabular-nums">{value}</div>
          <div className="text-dim">{label}</div>
        </div>
      ))}
    </div>
  );
}
