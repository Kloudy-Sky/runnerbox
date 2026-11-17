import type { PullRequest } from "@runnerbox/contracts";
import { STANDINGS, type Standing, standingOf, standingWords } from "../../lib/pullStanding.ts";
import { cn } from "../../lib/utils.ts";

const fill = {
  safe: "bg-success text-black",
  reviewing: "bg-foreground/35 text-foreground",
  fix: "bg-destructive text-black",
  unreviewed: "bg-foreground/10 text-muted-foreground",
} as const satisfies Record<Standing, string>;

function Total({ label, value, under }: { label: string; value: number; under: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold text-[28px] tabular-nums leading-tight tracking-tight">{value}</div>
      <div className="truncate text-muted-foreground text-xs">{under}</div>
    </div>
  );
}

// The open pull requests counted, then one tall bar of them by where their review stands. Only
// what the reviews view holds: how many reviews ran and what they cost aren't in it.
export function PullTotals({ pulls }: { pulls: ReadonlyArray<PullRequest> }) {
  const byStanding = Map.groupBy(pulls, standingOf);
  const count = (standing: Standing) => byStanding.get(standing)?.length ?? 0;
  const repos = new Set(pulls.map((pull) => pull.repo)).size;
  const toFix = byStanding.get("fix") ?? [];
  const shown = STANDINGS.filter((standing) => count(standing) > 0);
  return (
    <div className="pt-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-x-7 gap-y-5">
        <Total label="Open" value={pulls.length} under={`on ${repos} ${repos === 1 ? "repository" : "repositories"}`} />
        <Total label="Safe to merge" value={count("safe")} under="reviewed, nothing to fix" />
        <Total label="To fix" value={toFix.length} under={toFix.length > 0 && toFix.length <= 3 ? toFix.map((pull) => `#${pull.number}`).join(", ") : "found by a review"} />
      </div>
      {pulls.length > 0 ? (
        <>
          <div className="mt-7 flex h-7 gap-0.5" role="img" aria-label={shown.map((standing) => `${count(standing)} ${standingWords[standing].toLowerCase()}`).join(", ")}>
            {shown.map((standing) => (
              <span key={standing} style={{ flex: count(standing) }} className={cn("flex min-w-6 items-center rounded pl-2 font-semibold text-xs", fill[standing])}>
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
        </>
      ) : null}
    </div>
  );
}
