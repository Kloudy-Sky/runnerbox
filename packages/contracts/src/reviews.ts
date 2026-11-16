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
});
export type ReviewsView = typeof ReviewsView.Type;

export class ReviewError extends Schema.TaggedError<ReviewError>()("ReviewError", {
  reason: Schema.Literals(["unreadable", "bad_key", "app_refused", "github_unreachable", "not_connected", "unknown_repo"]),
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
    }
  }
}
