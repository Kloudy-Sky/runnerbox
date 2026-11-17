import { cn } from "../../lib/utils.ts";
import { checkSegment } from "./CheckSegments.tsx";

const shown = [
  ["passed", "Check passed"],
  ["running", "Running"],
  ["waiting", "Waiting for a runner"],
  ["failed", "Failed"],
] as const;

// What a check segment's look means, under the table.
export function CheckLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-4 text-muted-foreground text-xs">
      {shown.map(([state, words]) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span className={cn("size-[9px] rounded-[2px]", checkSegment[state])} />
          {words}
        </span>
      ))}
    </div>
  );
}
