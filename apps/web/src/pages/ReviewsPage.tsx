import type { ReviewsView } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader.tsx";
import { Input } from "../components/ui/input.tsx";
import { useReviews } from "../hooks/useReviews.ts";
import { formatAge } from "../lib/format.ts";
import type { RootSearch } from "../lib/search.ts";

const th = "py-1.5 pr-4 text-left font-normal text-muted-foreground";
const shortRepo = (repo: string) => repo.slice(repo.indexOf("/") + 1);

// What stands between the owner and a list, in the order they'd fix it.
function nothingToShow(view: ReviewsView) {
  if (view.app === null) return "Connect a GitHub App to see pull requests here.";
  if (!view.repos.some((repo) => repo.review)) return "No repository has reviews turned on.";
  return null;
}

// The open pull requests on the repositories with reviews on. A row opens the pull request on GitHub.
export function ReviewsPage() {
  const { view, available } = useReviews();
  const [filter, setFilter] = useState("");
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
              <th className={th}>Branch</th>
              <th className={th}>Opened</th>
              <th className={`${th} pr-6`}>Changed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((pull) => (
              <tr key={`${pull.repo}#${pull.number}`} className="hover:bg-surface">
                <td className="py-1 pr-4 pl-6">
                  <a href={`https://github.com/${pull.repo}/pull/${pull.number}`} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
                    <span className="text-muted-foreground tabular-nums">#{pull.number}</span> {pull.title}
                  </a>
                  {pull.draft ? <span className="pl-2 text-muted-foreground">draft</span> : null}
                </td>
                <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{shortRepo(pull.repo)}</td>
                <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{pull.author}</td>
                <td className="max-w-64 truncate py-1 pr-4 whitespace-nowrap text-muted-foreground">{pull.branch}</td>
                <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{formatAge(pull.openedAt)} ago</td>
                <td className="py-1 pr-6 whitespace-nowrap text-muted-foreground">{formatAge(pull.updatedAt)} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
