import type { Review, ReviewFinding } from "@runnerbox/contracts";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { PriorityMark } from "../components/reviews/PriorityMark.tsx";
import { Button } from "../components/ui/button.tsx";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard.ts";
import { usePullReviews } from "../hooks/usePullReviews.ts";
import { useReviews } from "../hooks/useReviews.ts";
import { formatAge, formatDuration } from "../lib/format.ts";
import { fixPrompt, going, impactWords, lineRange } from "../lib/reviewWords.ts";
import type { RootSearch } from "../lib/search.ts";

const keepSearch = (previous: RootSearch) => previous;

// One finding: what's wrong, where, and the lines it points at as they are at the reviewed commit.
function Finding({ finding }: { finding: ReviewFinding }) {
  return (
    <details open className="group py-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
        <PriorityMark priority={finding.priority} />
        <span className="font-medium">{finding.title}</span>
        <span className="font-mono text-muted-foreground text-xs">{lineRange(finding)}</span>
      </summary>
      <p className="max-w-[72ch] pt-2 leading-relaxed">{finding.body}</p>
      {finding.rule ? <p className="max-w-[72ch] pt-1 text-muted-foreground">Rule: "{finding.rule}"</p> : null}
      {finding.code.length > 0 ? (
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface py-2 font-mono text-xs leading-5">
          {finding.code.map(({ line, text }) => (
            <div key={line} className="px-3">
              <span className="inline-block w-10 select-none pr-3 text-right text-muted-foreground tabular-nums">{line}</span>
              {text}
            </div>
          ))}
        </pre>
      ) : null}
    </details>
  );
}

// What a review that isn't done has to say for itself.
function Unfinished({ review }: { review: Review }) {
  if (review.state === "queued") return <p className="text-muted-foreground">Waiting for the review ahead of it.</p>;
  if (review.state === "running") return <p className="text-muted-foreground">Reviewing. Started {formatAge(review.startedAt)} ago.</p>;
  if (review.state === "stopped") return <p className="text-muted-foreground">Stopped before it finished.</p>;
  return <p className="text-destructive">{review.problem ?? "The review failed."}</p>;
}

// A pull request's reviews: the newest one's score and verdict, then its findings. Nothing here has
// been posted to GitHub.
export function ReviewPage() {
  const { owner = "", name = "", number = "" } = useParams({ strict: false });
  const repo = `${owner}/${name}`;
  const pullNumber = Number(number);
  const { view, canRun, start, stop } = useReviews();
  const kept = usePullReviews(repo, pullNumber);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  if (!canRun) return <p className="px-6 pt-6 text-muted-foreground">This server can't review pull requests yet. Update it from Settings, under About.</p>;
  if (kept.data === undefined) return kept.isError ? <p className="px-6 pt-6 text-destructive">{kept.error instanceof Error ? kept.error.message : "Couldn't read the reviews."}</p> : null;
  const { reviews, canReview } = kept.data;
  const newest = reviews[0];
  const review = reviews.find((each) => each.id === pickedId) ?? newest;
  const pull = view?.pulls.find((each) => each.repo === repo && each.number === pullNumber);
  const act = (work: Promise<unknown>) => {
    setError(null);
    setPickedId(null);
    work.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "That didn't work."));
  };
  const behind = review !== undefined && pull !== undefined && pull.headSha !== "" && pull.headSha !== review.headSha;
  const model = review === undefined ? "" : (view?.models?.find((each) => each.id === review.model)?.label ?? review.model);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10 text-[13px]">
      <div className="max-w-4xl">
        <p className="text-muted-foreground">
          <Link to="/reviews" search={keepSearch} className="underline-offset-4 hover:underline">
            Reviews
          </Link>{" "}
          / {name} /{" "}
          <a href={`https://github.com/${repo}/pull/${pullNumber}`} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:underline">
            #{pullNumber} on GitHub
          </a>
        </p>
        <h1 className="pt-1 font-medium text-lg">{review?.title ?? pull?.title ?? `Pull request #${pullNumber}`}</h1>
        {review ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-muted-foreground">
            <span>
              {review.branch} into {review.base}
            </span>
            <span className="font-mono text-xs">{review.headSha.slice(0, 7)}</span>
            <span>
              {review.changedFiles} {review.changedFiles === 1 ? "file" : "files"}, +{review.additions} -{review.deletions}
            </span>
            <span>{model}</span>
            {review.finishedAt ? <span>took {formatDuration(Date.parse(review.finishedAt) - Date.parse(review.startedAt))}</span> : null}
            {review.state === "done" ? (
              <span>
                read {review.filesRead} {review.filesRead === 1 ? "file" : "files"}
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 pt-5">
          {review?.state === "done" ? (
            <>
              <div className="font-medium text-3xl tabular-nums leading-none">
                {review.score}
                <span className="text-base text-muted-foreground">/5</span>
              </div>
              <div className="min-w-64 flex-1">
                <p>
                  <span className="font-medium">{review.impact ? `${impactWords[review.impact]} impact.` : null}</span> {review.reach}
                </p>
                <p>{review.verdict}</p>
                <p className="pt-1 text-muted-foreground">Held here. Nothing was posted to the pull request.</p>
              </div>
            </>
          ) : (
            <div className="min-w-64 flex-1">{review ? <Unfinished review={review} /> : <p className="text-muted-foreground">No review yet.</p>}</div>
          )}
          <div className="flex gap-2">
            {review?.state === "done" && review.findings.length > 0 ? (
              <Button size="xs" variant="outline" onClick={() => copyToClipboard(fixPrompt(review))}>
                {isCopied ? "Copied" : "Copy fix prompt"}
              </Button>
            ) : null}
            {!canReview ? null : going(newest) ? (
              <Button size="xs" variant="outline" onClick={() => act(stop(repo, pullNumber))}>
                Stop
              </Button>
            ) : (
              <Button size="xs" variant="outline" onClick={() => act(start(repo, pullNumber))}>
                {newest ? "Review again" : "Review"}
              </Button>
            )}
          </div>
        </div>
        {error ? <p className="pt-2 text-destructive">{error}</p> : null}
        {behind ? <p className="pt-2 text-warning">The pull request has new commits since this review.</p> : null}

        {review?.state === "done" ? (
          <div className="pt-4">
            {review.findings.length === 0 ? <p className="text-muted-foreground">No findings.</p> : review.findings.map((finding) => <Finding key={`${finding.path}:${finding.startLine}:${finding.title}`} finding={finding} />)}
          </div>
        ) : null}

        {reviews.length > 1 ? (
          <div className="pt-6">
            <p className="pb-1 text-muted-foreground">Reviews of this pull request</p>
            {reviews.map((each) => (
              <button key={each.id} type="button" onClick={() => setPickedId(each.id)} className={`flex w-full gap-4 py-1 text-left hover:bg-surface ${each.id === review?.id ? "" : "text-muted-foreground"}`}>
                <span className="w-16">{formatAge(each.startedAt)} ago</span>
                <span className="font-mono text-xs leading-5">{each.headSha.slice(0, 7)}</span>
                <span className="w-10 tabular-nums">{each.score ? `${each.score}/5` : "-"}</span>
                <span>{each.state === "done" ? `${each.findings.length} ${each.findings.length === 1 ? "finding" : "findings"}` : each.state}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
