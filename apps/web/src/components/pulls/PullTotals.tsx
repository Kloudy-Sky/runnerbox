import type { PullRequest } from "@runnerbox/contracts";
import { useRpcQueryEverywhere } from "../../hooks/useRpcQueryEverywhere.ts";
import { type Standing, standingOf } from "../../lib/pullStanding.ts";
import { StandingBar } from "./StandingBar.tsx";

const usd = (value: number) => `$${value.toFixed(2)}`;

function Total({ label, value, under }: { label: string; value: number | string; under: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold text-[28px] tabular-nums leading-tight tracking-tight">{value}</div>
      <div className="truncate text-muted-foreground text-xs">{under}</div>
    </div>
  );
}

// The open pull requests counted, then one tall bar of them by where they stand. Reviews and their
// cost over the last seven days come from every machine's daily totals, which cover every
// repository whatever the filters say. A server older than those totals adds nothing to them.
export function PullTotals({ pulls }: { pulls: ReadonlyArray<PullRequest> }) {
  const week = useRpcQueryEverywhere(["dailyTotals", 7, null], (client) => client["history.dailyTotals"]({ days: 7 }), { refetchEvery: 60_000 }).flatMap(({ data }) => data ?? []);
  const reviews = week.reduce((sum, day) => sum + day.reviews, 0);
  const cost = week.reduce((sum, day) => sum + day.reviewCostUsd, 0);
  const byStanding = Map.groupBy(pulls, standingOf);
  const count = (standing: Standing) => byStanding.get(standing)?.length ?? 0;
  const repos = new Set(pulls.map((pull) => pull.repo)).size;
  const toFix = byStanding.get("fix") ?? [];
  return (
    <div className="pt-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-x-7 gap-y-5">
        <Total label="Open" value={pulls.length} under={`on ${repos} ${repos === 1 ? "repository" : "repositories"}`} />
        <Total label="Safe to merge" value={count("safe")} under="checks and review clean" />
        <Total label="To fix" value={toFix.length} under={toFix.length > 0 && toFix.length <= 3 ? toFix.map((pull) => `#${pull.number}`).join(", ") : "a finding or a failed check"} />
        {week.length > 0 ? (
          <>
            <Total label="Reviews" value={reviews} under="in the last 7 days" />
            <Total label="On your Claude account" value={usd(cost)} under={reviews > 0 ? `${usd(cost / reviews)} a review` : "in the last 7 days"} />
          </>
        ) : null}
      </div>
      <StandingBar pulls={pulls} className="mt-7" />
    </div>
  );
}
