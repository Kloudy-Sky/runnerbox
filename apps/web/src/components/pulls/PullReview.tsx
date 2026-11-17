import type { PullRequest, Review, ReviewsView } from "@runnerbox/contracts";
import { useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";
import { usePullReviews } from "../../hooks/usePullReviews.ts";
import { formatAge, formatDuration } from "../../lib/format.ts";
import { fixPrompt, going, impactWords } from "../../lib/reviewWords.ts";
import { Button } from "../ui/button.tsx";
import { FindingBlock } from "./FindingBlock.tsx";
import { SectionLabel } from "./SectionLabel.tsx";

type Props = {
  readonly pull: PullRequest;
  // The machine that keeps this pull request's reviews, and its view.
  readonly environmentId: string;
  readonly view: ReviewsView;
  readonly start: () => Promise<unknown>;
  readonly stop: () => Promise<unknown>;
};

const ago = (iso: string) => (Date.now() - Date.parse(iso) < 60_000 ? "just now" : `${formatAge(iso)} ago`);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// What a review that isn't done has to say for itself.
function unfinished(review: Review) {
  if (review.state === "queued") return <p className="text-muted-foreground">Waiting for the review ahead of it.</p>;
  if (review.state === "running") return <p className="text-muted-foreground">Reviewing. Started {formatAge(review.startedAt)} ago.</p>;
  if (review.state === "stopped") return <p className="text-muted-foreground">Stopped before it finished.</p>;
  return <p className="text-destructive">{review.problem ?? "The review failed."}</p>;
}

// An opened pull request's review: its verdict and reach, each finding with the code it points at,
// and what to do next. Older reviews of it can be picked. Nothing here was posted to GitHub.
export function PullReview({ pull, environmentId, view, start, stop }: Props) {
  const kept = usePullReviews(environmentId, pull.repo, pull.number);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const reviews = kept.data?.reviews ?? [];
  const canReview = kept.data?.canReview ?? false;
  const newest = reviews[0];
  const review = reviews.find((each) => each.id === pickedId) ?? newest;
  const act = (work: Promise<unknown>) => {
    setError(null);
    setPickedId(null);
    work.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "That didn't work."));
  };
  const behind = review !== undefined && pull.headSha !== "" && pull.headSha !== review.headSha;
  const model = review === undefined ? "" : (view.models?.find((each) => each.id === review.model)?.label ?? review.model);
  const github = `https://github.com/${pull.repo}/pull/${pull.number}`;

  if (kept.data === undefined) return kept.isError ? <p className="pt-3 text-destructive">{kept.error instanceof Error ? kept.error.message : "Couldn't read the reviews."}</p> : null;
  return (
    <div>
      <SectionLabel>{review === undefined ? "Review" : `Review of ${behind ? "an earlier" : "the latest"} push, ${ago(review.startedAt)}`}</SectionLabel>
      {review === undefined ? (
        <p className="text-muted-foreground">Not reviewed yet.</p>
      ) : review.state === "done" ? (
        <>
          <p className="max-w-[80ch]">
            <span className="font-semibold">{review.verdict}</span> {review.reach} The reviewer read {plural(review.filesRead, "file", "files")} beyond the diff.
          </p>
          <p className="flex flex-wrap gap-x-4 text-muted-foreground text-xs">
            <span>{review.score}/5</span>
            {review.impact ? <span>{impactWords[review.impact]} impact</span> : null}
            <span>{model}</span>
            {review.finishedAt ? <span>took {formatDuration(Date.parse(review.finishedAt) - Date.parse(review.startedAt))}</span> : null}
            <span className="font-mono">{review.headSha.slice(0, 7)}</span>
            <span>held here, posted nowhere</span>
          </p>
        </>
      ) : (
        unfinished(review)
      )}
      {behind ? <p className="pt-1 text-warning">The pull request has new commits since this review.</p> : null}
      {review?.state === "done" ? review.findings.map((finding) => <FindingBlock key={`${finding.path}:${finding.startLine}:${finding.title}`} finding={finding} />) : null}
      {error ? <p className="pt-2 text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-3">
        {review?.state === "done" && review.findings.length > 0 ? (
          <Button size="xs" className="border-transparent bg-foreground text-background hover:bg-foreground/90" onClick={() => copyToClipboard(fixPrompt(review))}>
            {isCopied ? "Copied" : "Copy fix prompt"}
          </Button>
        ) : null}
        {!canReview ? null : going(newest) ? (
          <Button size="xs" variant="outline" onClick={() => act(stop())}>
            Stop
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={() => act(start())}>
            {newest ? "Review again" : "Review"}
          </Button>
        )}
        <a href={github} target="_blank" rel="noreferrer noopener" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Open on GitHub
        </a>
      </div>

      {reviews.length > 1 ? (
        <div className="pt-3">
          <SectionLabel>Every review of it</SectionLabel>
          {reviews.map((each) => (
            <button key={each.id} type="button" onClick={() => setPickedId(each.id)} className={`flex w-full gap-4 py-0.5 text-left hover:text-foreground ${each.id === review?.id ? "" : "text-muted-foreground"}`}>
              <span className="w-16">{ago(each.startedAt)}</span>
              <span className="font-mono text-xs leading-5">{each.headSha.slice(0, 7)}</span>
              <span className="w-10 tabular-nums">{each.score ? `${each.score}/5` : "-"}</span>
              <span>{each.state === "done" ? plural(each.findings.length, "finding", "findings") : each.state}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
