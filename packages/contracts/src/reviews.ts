import * as Schema from "effect/Schema";
import { RepoName } from "./history.ts";

// Code review: the open pull requests on the repositories the owner picked, read through a GitHub
// App the owner made and installed on them. The App's key is kept on the server's machine.

export const GitHubAppId = Schema.String.check(Schema.isPattern(/^\d{1,12}$/));
// Write-only: the private key GitHub gave when the App was made, as its .pem file reads. It goes to
// the server and is never sent back.
export const GitHubAppKey = Schema.String.check(Schema.isMaxLength(8192), Schema.isPattern(/^\s*-----BEGIN (RSA )?PRIVATE KEY-----[A-Za-z0-9+/=\s]+-----END (RSA )?PRIVATE KEY-----\s*$/));

// The App as GitHub names it, which is the name its comments will carry.
export const ReviewApp = Schema.Struct({ slug: Schema.String, name: Schema.String });
export type ReviewApp = typeof ReviewApp.Type;

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
  // Null until the owner connects an App.
  app: Schema.NullOr(ReviewApp),
  repos: Schema.Array(ReviewRepo),
  // Open pull requests on the repositories with reviews on, the most recently changed first.
  pulls: Schema.Array(PullRequest),
  // Why the lists may be short or out of date, such as GitHub refusing the App's key.
  problem: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.String),
  // Whether this session may connect an App or turn a repository on.
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
  reason: Schema.Literals(["unreadable", "bad_key", "app_refused", "github_unreachable", "not_connected", "unknown_repo", "reviews_off", "pull_not_found", "review_running", "no_review", "provider_unavailable", "model_not_offered", "no_code_access"]),
}) {
  override get message() {
    switch (this.reason) {
      case "unreadable":
        return "Couldn't read or write the review settings on the server.";
      case "bad_key":
        return "That isn't a private key GitHub Apps use. Paste the whole .pem file.";
      case "app_refused":
        return "GitHub refused that App ID and key. Check both belong to the same App.";
      case "github_unreachable":
        return "The server couldn't get an answer from GitHub about the App. Try again in a minute.";
      case "not_connected":
        return "No GitHub App is connected.";
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
      case "no_code_access":
        return "GitHub wouldn't let the App read that repository's code. Give the App the Contents permission, read-only.";
    }
  }
}
