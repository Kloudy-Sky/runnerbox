import { cn } from "../../lib/utils.ts";

type Key = { readonly label: string; readonly mark: "box" | "line" | "dash"; readonly className: string };

const MARK = {
  box: "size-[9px] rounded-[2px]",
  line: "h-0.5 w-3.5",
  dash: "h-0 w-3.5 border-t-2 border-dashed",
} as const;

// What each colour or line on a chart is, in a row above it. `className` colours the mark only;
// the words stay in text colours.
export function ChartLegend({ keys }: { keys: ReadonlyArray<Key> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pb-2 text-muted-foreground text-xs">
      {keys.map((key) => (
        <span key={key.label} className="inline-flex items-center gap-1.5">
          <span className={cn(MARK[key.mark], key.className)} />
          {key.label}
        </span>
      ))}
    </div>
  );
}
