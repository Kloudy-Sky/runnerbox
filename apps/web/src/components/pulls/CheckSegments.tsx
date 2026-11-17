import type { Check } from "@runnerbox/contracts";
import { checkStateWords } from "../../lib/checkWords.ts";
import { cn } from "../../lib/utils.ts";

// Checks don't carry a usual time yet, so a running one fills its whole segment.
export const checkSegment = {
  passed: "bg-success/60",
  failed: "bg-destructive",
  running: "bg-foreground/90",
  waiting: "shadow-[inset_0_0_0_1px] shadow-muted-foreground/70",
  skipped: "bg-foreground/10",
  cancelled: "bg-foreground/10",
} as const satisfies Record<Check["state"], string>;

// A pull request's head commit checks as a row of small segments. Hovering one names it.
export function CheckSegments({ checks }: { checks: ReadonlyArray<Check> | undefined }) {
  if (checks === undefined) return <span className="text-muted-foreground">-</span>;
  if (checks.length === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="flex gap-[3px]">
      {checks.map((check) => {
        const label = `${check.workflow ? `${check.workflow} / ` : ""}${check.name}: ${checkStateWords[check.state]}`;
        return (
          <span key={`${check.workflow}\0${check.name}`} title={label} aria-label={label} className="max-w-[22px] flex-1 py-1">
            <span className={cn("block h-2 rounded-[2px]", checkSegment[check.state])} />
          </span>
        );
      })}
    </span>
  );
}
