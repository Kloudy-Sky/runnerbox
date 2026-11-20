import { useAtomValue } from "@effect/atom-react";
import type { ReviewsView } from "@runnerbox/contracts";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { PageBar } from "../components/PageBar.tsx";
import { PageBody } from "../components/PageBody.tsx";
import { CheckLegend } from "../components/pulls/CheckLegend.tsx";
import { type PullFilter, PullFilters } from "../components/pulls/PullFilters.tsx";
import { pullColumns, PullRow, wideOnly } from "../components/pulls/PullRow.tsx";
import { PullTotals } from "../components/pulls/PullTotals.tsx";
import { usePullRequestsEverywhere } from "../hooks/usePullRequestsEverywhere.ts";
import { standingOf } from "../lib/pullStanding.ts";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";
import { loginsAtom } from "../state/github.ts";

// Why there's nothing to list on any machine, and the settings page that fixes it.
function nothingToShow(views: ReadonlyArray<ReviewsView>) {
  if (views.every((view) => view.app === null)) return { why: "Sign the server in to GitHub to see pull requests here.", fix: "/settings/github" } as const;
  if (!views.some((view) => view.repos.some((repo) => repo.review))) return { why: "No repository has reviews turned on.", fix: "/settings/reviews" } as const;
  return null;
}

// The open pull requests on every connected machine's repositories with reviews on: how many are
// safe to merge or have something to fix, then each one grouped by repository with its checks and
// its newest review. The pull request in the URL is open in place.
export function PullRequestsPage() {
  const { machines, pulls, refused, start, stop } = usePullRequestsEverywhere();
  // "Yours" is any login a machine is signed in to GitHub as.
  const logins = new Set([...useAtomValue(loginsAtom).values()].map((login) => login.toLowerCase()));
  const { owner, name, number } = useParams({ strict: false });
  const openedKey = owner && name && number ? `${owner}/${name}#${number}` : null;
  const [filter, setFilter] = useState<PullFilter>({ repo: null, yours: false, standing: null });
  if (machines.length === 0) {
    return (
      <>
        <PageBar title="Pull requests" />
        <PageBody width="expanded">{refused ? <p className="text-muted-foreground">This server is older than reviews. Update it from Settings, under About.</p> : null}</PageBody>
      </>
    );
  }
  const views = machines.map((machine) => machine.view);
  const blocked = nothingToShow(views);
  const repos = [...new Set(views.flatMap((view) => view.repos.filter((repo) => repo.review).map((repo) => repo.repo)))].toSorted();
  const yours = filter.yours && logins.size > 0;
  // Totals count what the repository and whose filters leave; the standing filter only narrows the table.
  const scoped = pulls.filter(({ pull }) => (filter.repo === null || pull.repo === filter.repo) && (!yours || logins.has(pull.author.toLowerCase())));
  const rows = scoped.filter(({ pull }) => filter.standing === null || standingOf(pull) === filter.standing);
  const groups = Map.groupBy(rows, ({ pull }) => pull.repo);
  // A machine's note is named after it once there's more than one.
  const named = (label: string, text: string) => (machines.length > 1 ? `${label}: ${text}` : text);
  return (
    <>
      <PageBar title="Pull requests">{blocked === null ? <PullFilters filter={filter} onChange={setFilter} repos={repos} canTellYours={logins.size > 0} /> : null}</PageBar>
      <PageBody width="expanded" className="@container block">
      {machines.map(({ environmentId, label, view }) => (
        <div key={environmentId}>
          {view.problem ? <p className="pb-2 text-warning">{named(label, view.problem)}</p> : null}
          {view.autoPaused ? <p className="pb-2 text-warning">{named(label, "40 reviews have started on their own in the last day, so new pushes wait. Review still works on any pull request.")}</p> : null}
        </div>
      ))}
      {blocked !== null ? (
        <p className="text-muted-foreground">
          {blocked.why}{" "}
          {views.some((view) => view.canConfigure) ? (
            <Link to={blocked.fix} search={(previous: RootSearch) => previous} className="text-foreground underline-offset-4 hover:underline">
              Open Settings
            </Link>
          ) : null}
        </p>
      ) : (
        <>
          <PullTotals pulls={scoped.map(({ pull }) => pull)} />
          {rows.length === 0 ? (
            <p className="pt-8 text-muted-foreground">{pulls.length === 0 ? "No open pull requests." : yours && scoped.length === 0 ? "None of them are yours." : "No pull request matches."}</p>
          ) : (
            <div className="pt-7">
              <div className={cn(pullColumns, "text-muted-foreground text-xs")}>
                <span>Pull request</span>
                <span>Checks</span>
                <span className={wideOnly}>Review</span>
                <span className={cn(wideOnly, "justify-end")}>Updated</span>
              </div>
              {[...groups].map(([repo, inRepo]) => (
                <section key={repo}>
                  <div className="flex justify-between gap-2.5 pt-5 pb-1.5 font-semibold">
                    <span className="truncate">{repo}</span>
                    <span className="font-normal text-muted-foreground text-xs">{inRepo.length} open</span>
                  </div>
                  {inRepo.map(({ pull, environmentId, view }) => (
                    <PullRow
                      key={pull.number}
                      pull={pull}
                      environmentId={environmentId}
                      view={view}
                      opened={openedKey === `${pull.repo}#${pull.number}`}
                      start={() => start(environmentId, pull.repo, pull.number)}
                      stop={() => stop(environmentId, pull.repo, pull.number)}
                    />
                  ))}
                </section>
              ))}
              <CheckLegend />
            </div>
          )}
        </>
      )}
      </PageBody>
    </>
  );
}
