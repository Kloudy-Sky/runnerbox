import * as Schema from "effect/Schema";

// The server's sign-in to GitHub, through the one GitHub App every install shares. The owner
// approves a code on GitHub and the server keeps a token for that user alone, on its own machine.
// The App has no private key and the sign-in uses no secret, so nothing but that token exists.

// The App as GitHub names it. `slug` is where it's installed from: github.com/apps/<slug>.
export const GitHubAppName = Schema.Struct({ slug: Schema.String, name: Schema.String });
export type GitHubAppName = typeof GitHubAppName.Type;

// The code to type at `verificationUri`, which GitHub stops taking at `expiresAt`.
export const GitHubSignInPrompt = Schema.Struct({ userCode: Schema.String, verificationUri: Schema.String, expiresAt: Schema.String });
export type GitHubSignInPrompt = typeof GitHubSignInPrompt.Type;

// Why the last sign-in ended without one: the owner said no, the code ran out, or GitHub didn't answer.
export const GitHubSignInFailure = Schema.Literals(["denied", "expired", "failed"]);
export type GitHubSignInFailure = typeof GitHubSignInFailure.Type;

// An account or organization the App is installed on that the signed-in user can see.
export const GitHubInstallation = Schema.Struct({
  account: Schema.String,
  // How many repositories it was given, or null for all of the account's.
  repositories: Schema.NullOr(Schema.Int),
  // Its page on GitHub, where repositories are added and removed.
  manageUrl: Schema.NullOr(Schema.String),
});
export type GitHubInstallation = typeof GitHubInstallation.Type;

export const GitHubStatus = Schema.Struct({
  // Null on a server that has no App to sign in through.
  app: Schema.NullOr(GitHubAppName),
  // The GitHub login signed in, or null.
  account: Schema.NullOr(Schema.String),
  // A sign-in waiting for its code to be approved. Only a session that may sign in is shown it.
  pending: Schema.NullOr(GitHubSignInPrompt),
  failure: Schema.NullOr(GitHubSignInFailure),
  installations: Schema.Array(GitHubInstallation),
  // Why the installations may be short or out of date.
  problem: Schema.NullOr(Schema.String),
  // Whether this session may sign in and out.
  canConfigure: Schema.Boolean,
});
export type GitHubStatus = typeof GitHubStatus.Type;

export class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  reason: Schema.Literals(["unreadable", "not_configured", "github_unreachable"]),
}) {
  override get message() {
    switch (this.reason) {
      case "unreadable":
        return "Couldn't read or write the GitHub sign-in on the server.";
      case "not_configured":
        return "This server has no GitHub App to sign in through.";
      case "github_unreachable":
        return "The server couldn't get an answer from GitHub. Try again in a minute.";
    }
  }
}
