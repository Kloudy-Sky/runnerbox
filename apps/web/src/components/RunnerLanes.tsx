import type { ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip.tsx";

// A span of one runner's hour, as fractions of the hour (0 is an hour ago, 1 is now). `title` is
// what hovering it says.
export type LaneSpan = { readonly start: number; readonly end: number; readonly fill: string; readonly title: string };
export type Lane = { readonly key: string; readonly label: string; readonly spans: ReadonlyArray<LaneSpan> };

// The last hour of each runner as a strip of plain boxes, with what each box was on hover. The Now
// view and the Runners page draw their own spans and legend with it. Gaps are left as they are.
export function RunnerLanes({ lanes, children }: { lanes: ReadonlyArray<Lane>; children?: ReactNode }) {
  if (lanes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {lanes.map((lane) => (
        <div key={lane.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2">
          <span className="truncate text-muted-foreground">{lane.label}</span>
          <span className="relative h-2.5 bg-muted">
            {lane.spans.map((span) => (
              <Tooltip key={`${span.start}-${span.fill}`}>
                <TooltipTrigger
                  render={
                    <span
                      className={`absolute inset-y-0 ${span.fill}`}
                      style={{ left: `${span.start * 100}%`, width: `${Math.max(0.5, (span.end - span.start) * 100)}%` }}
                    />
                  }
                />
                <TooltipPopup side="top">{span.title}</TooltipPopup>
              </Tooltip>
            ))}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 text-muted-foreground text-xs">
        <span />
        <span className="flex justify-between">
          <span>an hour ago</span>
          <span>now</span>
        </span>
      </div>
      {children}
    </div>
  );
}
