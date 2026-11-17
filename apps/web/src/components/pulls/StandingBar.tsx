import type { PullRequest } from "@runnerbox/contracts";
import { STANDINGS, type Standing, standingOf, standingWords } from "../../lib/pullStanding.ts";
import { cn } from "../../lib/utils.ts";

const fill = {
  safe: "bg-success text-black",
  going: "bg-foreground/35 text-foreground",
  fix: "bg-destructive text-black",
  unreviewed: "bg-foreground/10 text-muted-foreground",
} as const satisfies Record<Standing, string>;

// Open pull requests as one tall bar split by where they stand, with its legend. Pull requests and
// Overview both show it.
export function StandingBar({ pulls, className }: { pulls: ReadonlyArray<PullRequest>; className?: string }) {
  const byStanding = Map.groupBy(pulls, standingOf);
  const count = (standing: Standing) => byStanding.get(standing)?.length ?? 0;
  const shown = STANDINGS.filter((standing) => count(standing) > 0);
  if (pulls.length === 0) return null;
  return (
    <div className={className}>
      <div className="flex h-7 gap-0.5" role="img" aria-label={shown.map((standing) => `${count(standing)} ${standingWords[standing].toLowerCase()}`).join(", ")}>
        {shown.map((standing) => (
          <span key={standing} style={{ flex: count(standing) }} title={`${count(standing)} ${standingWords[standing].toLowerCase()}`} className={cn("flex min-w-6 items-center rounded pl-2 font-semibold text-xs", fill[standing])}>
            {count(standing)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-2.5 text-muted-foreground text-xs">
        {shown.map((standing) => (
          <span key={standing} className="inline-flex items-center gap-1.5">
            <span className={cn("size-[9px] rounded-[2px]", fill[standing])} />
            {standingWords[standing]}
          </span>
        ))}
      </div>
    </div>
  );
}
