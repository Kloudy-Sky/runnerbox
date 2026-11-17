import * as Schema from "effect/Schema";
import { GitHubAppName } from "./github.ts";
import { RepoName } from "./history.ts";

// Code review: the open pull requests on the repositories the owner picked, read through the
// server's sign-in to GitHub (github.ts), on the repositories the App is installed on.

// A repository the App is installed on, and whether the owner turned reviews on for it.
export const ReviewRepo = Schema.Struct({ repo: RepoName, review: Schema.Boolean });
export type ReviewRepo = typeof ReviewRepo.Type;

export const PullNumber = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000_000 }));

export const ReviewImpact = Schema.Literals(["low", "medium", "high", "critical"]);
export const ReviewPriority = Schema.Literals(["P1", "P2"]);

// One defect the reviewer verified. P1 should be fixed before merging; P2 is real but narrow.
export const ReviewFinding = Schema.Struct({
  priority: ReviewPriority,
  // The symptom as a person would see it, in a few words.
  title: Schema.String,
  path: Schema.String,
  startLine: Schema.Int,
  endLine: Schema.Int,
  body: Schema.String,
  // The line of the repository's AGENTS.md or CLAUDE.md it breaks, quoted.
  rule: Schema.NullOr(Schema.String),
  // The lines it points at, as they are at the reviewed commit. Empty when they couldn't be read.
  code: Schema.Array(Schema.Struct({ line: Schema.Int, text: Schema.String })),
});
export type ReviewFinding = typeof ReviewFinding.Type;

// `queued` waits for the review ahead of it. `stopped` is the owner's stop; `failed` says why in `problem`.
export const ReviewState = Schema.Literals(["queued", "running", "done", "failed", "stopped"]);
export type ReviewState = typeof ReviewState.Type;

// One review of one commit of a pull request. It's kept on the server and posted nowhere.
export const Review = Schema.Struct({
  id: Schema.String,
  repo: RepoName,
  number: Schema.Int,
  title: Schema.String,
  author: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  headSha: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  state: ReviewState,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  model: Schema.String,
  costUsd: Schema.NullOr(Schema.Number),
  // How many different files the reviewer opened beyond the diff.
  filesRead: Schema.Int,
  // 5 is safe to merge with no findings, 1 should not merge. Null until the review is done.
  score: Schema.NullOr(Schema.Int),
  impact: Schema.NullOr(ReviewImpact),
  // What the change touches, and what to do before merging, a sentence each.
  reach: Schema.NullOr(Schema.String),
  verdict: Schema.NullOr(Schema.String),
  findings: Schema.Array(ReviewFinding),
  problem: Schema.NullOr(Schema.String),
});
export type Review = typeof Review.Type;

// The newest review of a pull request, as its row in the list shows it.
export const ReviewSummary = Schema.Struct({
  id: Schema.String,
  state: ReviewState,
  headSha: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  score: Schema.NullOr(Schema.Int),
  impact: Schema.NullOr(ReviewImpact),
  p1: Schema.Int,
  p2: Schema.Int,
});
export type ReviewSummary = typeof ReviewSummary.Type;

// A pull request's reviews, the newest first.
export const PullReviews = Schema.Struct({ reviews: Schema.Array(Review), canReview: Schema.Boolean });
export type PullReviews = typeof PullReviews.Type;

export const ReviewModel = Schema.Struct({ id: Schema.String, label: Schema.String });

export const PullRequest = Schema.Struct({
  repo: RepoName,
  number: Schema.Int,
  title: Schema.String,
  author: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  headSha: Schema.String,
  draft: Schema.Boolean,
  openedAt: Schema.String,
  updatedAt: Schema.String,
  // Its newest review, when it has one. A server that can't review leaves it out.
  review: Schema.optionalKey(ReviewSummary),
  // Why it's never reviewed unasked: a draft, a bot's, or from a fork. Pressing Review still works.
  skipped: Schema.optionalKey(Schema.Literals(["draft", "bot", "fork"])),
});
export type PullRequest = typeof PullRequest.Type;

export const ReviewsView = Schema.Struct({
  // The App reviews read through, or null until the server is signed in to GitHub.
  app: Schema.NullOr(GitHubAppName),
  repos: Schema.Array(ReviewRepo),
  // Open pull requests on the repositories with reviews on, the most recently changed first.
  pulls: Schema.Array(PullRequest),
  // Why the lists may be short or out of date, such as GitHub not answering.
  problem: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.String),
  // Whether this session may turn a repository on.
  canConfigure: Schema.Boolean,
  // Whether this session may start and stop reviews, which run on the owner's Claude account.
  canReview: Schema.optionalKey(Schema.Boolean),
  // The model reviews run on, and the ones to pick from.
  model: Schema.optionalKey(Schema.String),
  models: Schema.optionalKey(Schema.Array(ReviewModel)),
  // True once as many reviews as a day allows have started unasked. Pressing Review still works.
  autoPaused: Schema.optionalKey(Schema.Boolean),
});
export type ReviewsView = typeof ReviewsView.Type;

export class ReviewError extends Schema.TaggedError<ReviewError>()("ReviewError", {
  reason: Schema.Literals(["unreadable", "github_unreachable", "not_connected", "unknown_repo", "reviews_off", "pull_not_found", "review_running", "no_review", "provider_unavailable", "model_not_offered"]),
}) {
  override get message() {
    switch (this.reason) {
      case "unreadable":
        return "Couldn't read or write the review settings on the server.";
      case "github_unreachable":
        return "The server couldn't get an answer from GitHub. Try again in a minute.";
      case "not_connected":
        return "The server isn't signed in to GitHub. Sign in under Settings, GitHub.";
      case "unknown_repo":
        return "The App isn't installed on that repository.";
      case "reviews_off":
        return "Reviews are off for that repository. Turn them on in Settings, Reviews.";
      case "pull_not_found":
        return "That pull request isn't open, or the App can't see it.";
      case "review_running":
        return "A review of that pull request is already running.";
      case "no_review":
        return "No review of that pull request is running.";
      case "provider_unavailable":
        return "Claude Code isn't ready on the server's machine. Check Settings, Providers.";
      case "model_not_offered":
        return "Reviews can't run on that model.";
    }
  }
}
