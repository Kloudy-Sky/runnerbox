import type { PullRequest, ReviewsView } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { formatAge } from "../../lib/format.ts";
import type { RootSearch } from "../../lib/search.ts";
import { cn } from "../../lib/utils.ts";
import { CheckSegments } from "./CheckSegments.tsx";
import { PullChecks } from "./PullChecks.tsx";
import { PullReview } from "./PullReview.tsx";
import { ReviewDot } from "./ReviewDot.tsx";

const keepSearch = (previous: RootSearch) => previous;

// The table's columns. Below 700px of page, only the pull request and its checks fit.
export const pullColumns = "grid grid-cols-[minmax(0,1fr)_90px] items-center gap-x-5 @[700px]:grid-cols-[minmax(0,1fr)_150px_150px_56px]";
export const wideOnly = "hidden @[700px]:flex";

type Props = {
  readonly pull: PullRequest;
  // The machine it's shown from, and that machine's view.
  readonly environmentId: string;
  readonly view: ReviewsView;
  readonly opened: boolean;
  readonly start: () => Promise<unknown>;
  readonly stop: () => Promise<unknown>;
};

// One pull request: its title, checks, review and age. Pressing it opens it in place, and the URL
// says which one is open.
export function PullRow({ pull, environmentId, view, opened, start, stop }: Props) {
  // A server that runs reviews says whether this session may; one that only lists them leaves it out.
  const canRun = view.canReview !== undefined;
  const [owner = "", name = ""] = pull.repo.split("/");
  return (
    <>
      <Link
        to={opened ? "/pulls" : "/pulls/$owner/$name/$number"}
        params={opened ? {} : { owner, name, number: String(pull.number) }}
        search={keepSearch}
        aria-expanded={opened}
        className={cn(pullColumns, "-mx-2.5 rounded-md px-2.5 py-[7px] hover:bg-surface", opened && "bg-surface")}
      >
        <span className="min-w-0 truncate">
          <span className="mr-1 text-muted-foreground tabular-nums">#{pull.number}</span> {pull.title}
          <span className="ml-2.5 text-muted-foreground text-xs">
            {pull.author} · {pull.branch}
            {pull.draft ? " · draft" : ""}
          </span>
        </span>
        <CheckSegments checks={pull.checks} />
        <span className={cn(wideOnly, "min-w-0")}>
          <ReviewDot pull={pull} />
        </span>
        <span className={cn(wideOnly, "justify-end text-muted-foreground tabular-nums")}>{formatAge(pull.updatedAt)}</span>
      </Link>
      {opened ? (
        <div className="mt-1 mb-1.5 border-border border-l-2 pt-1 pb-4 pl-[18px]">
          <PullChecks pull={pull} />
          {canRun ? (
            <PullReview pull={pull} environmentId={environmentId} view={view} start={start} stop={stop} />
          ) : (
            <div className="pt-3">
              <a href={`https://github.com/${pull.repo}/pull/${pull.number}`} target="_blank" rel="noreferrer noopener" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Open on GitHub
              </a>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
