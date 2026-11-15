import type { PlacedStep } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";
import { cn } from "../../lib/utils.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";

// A job's steps as one bar, each as long as it took, after T3 Code's share bar: a tooltip per
// segment, and the names and times underneath. A failed step is in the failure colour, and the step
// the sentence names stands out.
export function StepBar({ steps, marked }: { readonly steps: readonly PlacedStep[]; readonly marked: string | null }) {
  const ran = steps.filter((step) => (step.ms ?? 0) > 0);
  if (ran.length === 0) return null;
  const failed = (step: PlacedStep) => step.conclusion === "failure";
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={`Steps: ${ran.map((step) => `${step.name} ${formatDuration(step.ms)}`).join(", ")}`} className="flex h-5 gap-0.5">
        {ran.map((step, index) => (
          <Tooltip key={`${index}${step.name}`}>
            <TooltipTrigger
              render={
                <div
                  className={cn("h-full min-w-1 rounded-xs", failed(step) ? "bg-destructive" : step.name === marked ? "bg-info" : "bg-info/35")}
                  style={{ flex: `${step.ms} 1 0` }}
                />
              }
            />
            <TooltipPopup>
              {step.name} · {formatDuration(step.ms)}
              {failed(step) ? ", failed" : ""}
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {ran.map((step, index) => (
          <span key={`${index}${step.name}`} className={failed(step) || step.name === marked ? "text-foreground" : undefined}>
            {step.name} <span className="tabular-nums">{formatDuration(step.ms)}</span>
            {failed(step) ? ", failed" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
