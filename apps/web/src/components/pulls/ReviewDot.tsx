import type { PullRequest } from "@runnerbox/contracts";
import { formatAge } from "../../lib/format.ts";
import { hasFindings, standingOf } from "../../lib/pullStanding.ts";
import { skippedWords } from "../../lib/reviewWords.ts";
import { cn } from "../../lib/utils.ts";

// What a pull request's review and checks say, in a few words, and the dot that goes with it.
function said(pull: PullRequest) {
  const review = pull.review;
  const standing = standingOf(pull);
  if (hasFindings(pull)) return { words: `${(review?.p1 ?? 0) + (review?.p2 ?? 0)} to fix`, dot: "bg-destructive", text: "font-medium text-foreground" };
  if (standing === "fix") return { words: "A check failed", dot: "bg-destructive", text: "font-medium text-foreground" };
  if (standing === "safe") return { words: "Safe to merge", dot: "bg-success", text: "text-muted-foreground" };
  if (review?.state === "running") return { words: `Reviewing, ${formatAge(review.startedAt)} in`, dot: "bg-foreground/90", text: "text-muted-foreground" };
  if (review?.state === "queued") return { words: "Waiting to review", dot: "bg-foreground/90", text: "text-muted-foreground" };
  if (standing === "going") return { words: "Reviewed, checks running", dot: "bg-foreground/90", text: "text-muted-foreground" };
  if (review?.state === "failed") return { words: "Review failed", dot: "bg-destructive", text: "text-muted-foreground" };
  if (review?.state === "done") return { words: "New commits since", dot: "bg-muted-foreground/60", text: "text-muted-foreground" };
  if (review?.state === "stopped") return { words: "Stopped", dot: "bg-muted-foreground/60", text: "text-muted-foreground" };
  return { words: pull.skipped ? skippedWords[pull.skipped] : "Not reviewed", dot: "bg-muted-foreground/60", text: "text-muted-foreground" };
}

export function ReviewDot({ pull }: { pull: PullRequest }) {
  const { words, dot, text } = said(pull);
  return (
    <span className={cn("flex min-w-0 items-center gap-2 whitespace-nowrap", text)}>
      <span className={cn("size-[7px] flex-none rounded-full", dot)} aria-hidden />
      <span className="truncate">{words}</span>
    </span>
  );
}
