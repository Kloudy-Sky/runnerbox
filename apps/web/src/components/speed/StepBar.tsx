import { formatDuration } from "../../lib/format.ts";
import { cn } from "../../lib/utils.ts";

// One gray per rank, longest step lightest, so the eye lands on where the time goes. Steps aren't
// categories to tell apart by hue, and red, amber and green stay for state.
const GRAYS = ["#e6e6e3", "#a3a3a0", "#7a7a76", "#5c5c59"] as const;
// A block narrower than this share of the run prints no label; the legend under it has the value.
const LABEL_SHARE = 0.16;

// A run's steps as one tall segmented bar, in the order they ran, with each step's typical time.
// The step that grew most is outlined.
export function StepBar({ steps, marked }: { readonly steps: readonly { readonly name: string; readonly ms: number }[]; readonly marked: string | null }) {
  const total = steps.reduce((sum, step) => sum + step.ms, 0);
  const rank = new Map(steps.toSorted((a, b) => b.ms - a.ms).map((step, index) => [step.name, Math.min(index, GRAYS.length - 1)]));
  const gray = (name: string) => GRAYS[rank.get(name) ?? GRAYS.length - 1];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-7 gap-0.5" role="img" aria-label={`Steps of a typical run, ${formatDuration(total)} in all`}>
        {steps.map((step) => {
          const labelled = step.ms / total >= LABEL_SHARE;
          return (
            <span
              key={step.name}
              title={`${step.name} ${formatDuration(step.ms)}`}
              // Padding only on a labelled block, so a short step keeps its true width.
              className={cn("flex min-w-0.5 items-center overflow-hidden rounded-sm text-xs whitespace-nowrap hover:opacity-85", labelled && "px-1.5", step.name === marked && "ring-1 ring-foreground ring-offset-1 ring-offset-background")}
              style={{ flex: `${step.ms} 1 0`, background: gray(step.name), color: rank.get(step.name) === 0 ? "#141414" : "#ffffff" }}
            >
              {labelled ? `${step.name} ${formatDuration(step.ms)}` : null}
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {steps.map((step) => (
          <span key={step.name} className="flex items-center gap-1.5">
            <i className="size-2 rounded-[2px]" style={{ background: gray(step.name) }} />
            {step.name} {formatDuration(step.ms)}
          </span>
        ))}
      </div>
    </div>
  );
}
