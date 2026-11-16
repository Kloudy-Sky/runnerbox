import type { PullRequest, ReviewsView } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader.tsx";
import { PriorityMark } from "../components/reviews/PriorityMark.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { useReviews } from "../hooks/useReviews.ts";
import { formatAge } from "../lib/format.ts";
import { going, impactWords, reviewState } from "../lib/reviewWords.ts";
import type { RootSearch } from "../lib/search.ts";

const th = "py-1.5 pr-4 text-left font-normal text-muted-foreground";
const shortRepo = (repo: string) => repo.slice(repo.indexOf("/") + 1);

// What stands between the owner and a list, in the order they'd fix it.
function nothingToShow(view: ReviewsView) {
  if (view.app === null) return "Connect a GitHub App to see pull requests here.";
  if (!view.repos.some((repo) => repo.review)) return "No repository has reviews turned on.";
  return null;
}

// What the newest review of a pull request found, or a dash before there is one.
function Findings({ pull }: { pull: PullRequest }) {
  const review = pull.review;
  if (review === undefined || review.state !== "done") return <span className="text-muted-foreground">-</span>;
  if (review.p1 + review.p2 === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="inline-flex gap-3">
      {review.p1 > 0 ? <PriorityMark priority="P1" count={review.p1} /> : null}
      {review.p2 > 0 ? <PriorityMark priority="P2" count={review.p2} /> : null}
    </span>
  );
}

// The open pull requests on the repositories with reviews on, each with its newest review. A row
// opens that pull request's reviews.
export function ReviewsPage() {
  const { view, available, canRun, start, stop } = useReviews();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const act = (work: Promise<unknown>) => {
    setError(null);
    work.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "That didn't work."));
  };
  if (!available) return <p className="px-6 pt-6 text-muted-foreground">This server is older than reviews. Update it from Settings, under About.</p>;
  if (view === null) return null;
  const blocked = nothingToShow(view);
  const needle = filter.trim().toLowerCase();
  const rows = view.pulls.filter((pull) => !needle || `#${pull.number} ${pull.title} ${pull.repo} ${pull.author} ${pull.branch}`.toLowerCase().includes(needle));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PageHeader.Root>
        <PageHeader.Title>Reviews</PageHeader.Title>
        <PageHeader.Spacer />
        {blocked === null ? <Input value={filter} onValueChange={setFilter} placeholder="Filter by title, repo, author or branch" className="w-72" size="sm" /> : null}
      </PageHeader.Root>
      {view.problem ? <p className="px-6 pb-2 text-warning">{view.problem}</p> : null}
      {error ? <p className="px-6 pb-2 text-destructive">{error}</p> : null}
      {blocked !== null ? (
        <p className="px-6 text-muted-foreground">
          {blocked}{" "}
          {view.canConfigure ? (
            <Link to="/settings/reviews" search={(previous: RootSearch) => previous} className="text-foreground underline-offset-4 hover:underline">
              Open Settings
            </Link>
          ) : null}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-6 text-muted-foreground">{view.pulls.length === 0 ? "No open pull requests." : "No pull request matches."}</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`${th} pl-6`}>Pull request</th>
              <th className={th}>Repo</th>
              <th className={th}>Author</th>
              <th className={th}>Changed</th>
              {canRun ? (
                <>
                  <th className={th}>Score</th>
                  <th className={th}>Findings</th>
                  <th className={th}>Impact</th>
                  <th className={th}>Reviewed</th>
                  <th className={`${th} pr-6`}>State</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((pull) => (
              <tr key={`${pull.repo}#${pull.number}`} className="h-8 hover:bg-surface">
                <td className="py-1 pr-4 pl-6">
                  {canRun ? (
                    <Link to="/reviews/$owner/$name/$number" params={{ owner: pull.repo.slice(0, pull.repo.indexOf("/")), name: shortRepo(pull.repo), number: String(pull.number) }} search={(previous: RootSearch) => previous} className="underline-offset-2 hover:underline">
                      <span className="text-muted-foreground tabular-nums">#{pull.number}</span> {pull.title}
                    </Link>
                  ) : (
                    <a href={`https://github.com/${pull.repo}/pull/${pull.number}`} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
                      <span className="text-muted-foreground tabular-nums">#{pull.number}</span> {pull.title}
                    </a>
                  )}
                  {pull.draft ? <span className="pl-2 text-muted-foreground">draft</span> : null}
                </td>
                <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{shortRepo(pull.repo)}</td>
                <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{pull.author}</td>
                <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{formatAge(pull.updatedAt)} ago</td>
                {canRun ? (
                  <>
                    <td className="py-1 pr-4 whitespace-nowrap tabular-nums">{pull.review?.score ? `${pull.review.score}/5` : <span className="text-muted-foreground">-</span>}</td>
                    <td className="py-1 pr-4 whitespace-nowrap">
                      <Findings pull={pull} />
                    </td>
                    <td className="py-1 pr-4 whitespace-nowrap">{pull.review?.impact ? impactWords[pull.review.impact] : <span className="text-muted-foreground">-</span>}</td>
                    <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{pull.review ? `${formatAge(pull.review.finishedAt ?? pull.review.startedAt)} ago` : "-"}</td>
                    <td className="py-1 pr-6 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {pull.review ? <span className={pull.review.state === "failed" ? "text-destructive" : undefined}>{reviewState(pull.review, pull.headSha)}</span> : null}
                        {!view.canReview ? null : going(pull.review) ? (
                          <Button size="xs" variant="outline" onClick={() => act(stop(pull.repo, pull.number))}>
                            Stop
                          </Button>
                        ) : pull.review === undefined || pull.review.state !== "done" || pull.review.headSha !== pull.headSha ? (
                          <Button size="xs" variant="outline" onClick={() => act(start(pull.repo, pull.number))}>
                            Review
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
