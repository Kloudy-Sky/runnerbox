import type { ReviewsView } from "@runnerbox/contracts";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader.tsx";
import { CheckLegend } from "../components/pulls/CheckLegend.tsx";
import { type PullFilter, PullFilters } from "../components/pulls/PullFilters.tsx";
import { pullColumns, PullRow, wideOnly } from "../components/pulls/PullRow.tsx";
import { PullTotals } from "../components/pulls/PullTotals.tsx";
import { useGitHub } from "../hooks/useGitHub.ts";
import { useReviews } from "../hooks/useReviews.ts";
import { standingOf } from "../lib/pullStanding.ts";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";

// Why there's nothing to list, and the settings page that fixes it.
function nothingToShow(view: ReviewsView) {
  if (view.app === null) return { why: "Sign the server in to GitHub to see pull requests here.", fix: "/settings/github" } as const;
  if (!view.repos.some((repo) => repo.review)) return { why: "No repository has reviews turned on.", fix: "/settings/reviews" } as const;
  return null;
}

// The open pull requests on the repositories with reviews on: how many are safe to merge or have
// something to fix, then each one grouped by repository with its checks and its newest review. The
// pull request in the URL is open in place.
export function PullRequestsPage() {
  const { view, available, canRun, start, stop } = useReviews();
  const login = useGitHub().status?.account ?? null;
  const { owner, name, number } = useParams({ strict: false });
  const openedKey = owner && name && number ? `${owner}/${name}#${number}` : null;
  const [filter, setFilter] = useState<PullFilter>({ repo: null, yours: false, standing: null });
  if (!available) return <p className="px-6 pt-6 text-muted-foreground">This server is older than reviews. Update it from Settings, under About.</p>;
  if (view === null) return null;
  const blocked = nothingToShow(view);
  const repos = view.repos.filter((repo) => repo.review).map((repo) => repo.repo);
  const yours = filter.yours && login !== null;
  // Totals count what the repository and whose filters leave; the standing filter only narrows the table.
  const scoped = view.pulls.filter((pull) => (filter.repo === null || pull.repo === filter.repo) && (!yours || pull.author.toLowerCase() === login.toLowerCase()));
  const rows = scoped.filter((pull) => filter.standing === null || standingOf(pull) === filter.standing);
  const groups = Map.groupBy(rows, (pull) => pull.repo);
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto pb-10 text-[13px]">
      <PageHeader.Root>
        <PageHeader.Title>Pull requests</PageHeader.Title>
        <PageHeader.Spacer />
        {blocked === null ? <PullFilters filter={filter} onChange={setFilter} repos={repos} login={login} /> : null}
      </PageHeader.Root>
      <div className="px-6">
        {view.problem ? <p className="pb-2 text-warning">{view.problem}</p> : null}
        {view.autoPaused ? <p className="pb-2 text-warning">40 reviews have started on their own in the last day, so new pushes wait. Review still works on any pull request.</p> : null}
        {blocked !== null ? (
          <p className="text-muted-foreground">
            {blocked.why}{" "}
            {view.canConfigure ? (
              <Link to={blocked.fix} search={(previous: RootSearch) => previous} className="text-foreground underline-offset-4 hover:underline">
                Open Settings
              </Link>
            ) : null}
          </p>
        ) : (
          <>
            <PullTotals pulls={scoped} />
            {rows.length === 0 ? (
              <p className="pt-8 text-muted-foreground">{view.pulls.length === 0 ? "No open pull requests." : yours && scoped.length === 0 ? `None of them were opened by ${login}.` : "No pull request matches."}</p>
            ) : (
              <div className="pt-7">
                <div className={cn(pullColumns, "text-muted-foreground text-xs")}>
                  <span>Pull request</span>
                  <span>Checks</span>
                  <span className={wideOnly}>Review</span>
                  <span className={cn(wideOnly, "justify-end")}>Updated</span>
                </div>
                {[...groups].map(([repo, pulls]) => (
                  <section key={repo}>
                    <div className="flex justify-between gap-2.5 pt-5 pb-1.5 font-semibold">
                      <span className="truncate">{repo}</span>
                      <span className="font-normal text-muted-foreground text-xs">{pulls.length} open</span>
                    </div>
                    {pulls.map((pull) => (
                      <PullRow key={pull.number} pull={pull} view={view} opened={openedKey === `${pull.repo}#${pull.number}`} canRun={canRun} start={start} stop={stop} />
                    ))}
                  </section>
                ))}
                <CheckLegend />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
