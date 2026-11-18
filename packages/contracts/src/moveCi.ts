import * as Schema from "effect/Schema";
import { GitHubAppName } from "./github.ts";
import { RepoName } from "./history.ts";

// Move CI: where each job on a repository the App is installed on picks its runner, read from the
// workflows on its default branch through the server's sign-in (github.ts). A job that names its
// runner through a repository variable moves when the variable changes, with no commit. For the
// rest, the server drafts the patch that makes them read it. It never writes to the repository's
// code. With the App's Variables permission, it sets or deletes the variable itself.

export const RunnerVariable = Schema.Literals(["LINUX_RUNNER", "MAC_RUNNER"]);
export type RunnerVariable = typeof RunnerVariable.Type;

// `moves`: it reads a runner variable already. `patched`: the patch makes it read one. `left`: a
// runner the patch can't map, such as an expression, a list or a self-hosted label.
export const CiJobState = Schema.Literals(["moves", "patched", "left"]);
export type CiJobState = typeof CiJobState.Type;

// Why a job needs a runner kind with `"docker": true`, from what its workflow shows: `services:`,
// `container:`, a Docker action, or a `docker` command in a `run:` step.
export const DockerUse = Schema.Literals(["services", "container", "action", "command"]);
export type DockerUse = typeof DockerUse.Type;

export const CiJob = Schema.Struct({
  // The workflow's file, such as `.github/workflows/ci.yml`.
  workflow: Schema.String,
  job: Schema.String,
  // Its `runs-on:` as written, shortened.
  runsOn: Schema.String,
  state: CiJobState,
  // The variable it reads, or will once the patch is in. Null when it's left alone.
  variable: Schema.NullOr(RunnerVariable),
  docker: Schema.NullOr(DockerUse),
});
export type CiJob = typeof CiJob.Type;

// A label Runnerbox writes into a variable: one of this machine's runner kinds, matching the
// launcher's own pattern, since some workflows paste `vars` into a `run:` step.
export const RunnerLabel = Schema.String.check(Schema.isPattern(/^[\w.-]{1,100}$/));

// A runner kind on this machine. `mac` kinds run on the host and serve MAC_RUNNER; the rest serve LINUX_RUNNER.
export const CiRunner = Schema.Struct({ label: RunnerLabel, docker: Schema.Boolean, mac: Schema.Boolean });
export type CiRunner = typeof CiRunner.Type;

// A runner variable the repository's jobs read, as GitHub holds it. With neither value set, the
// jobs run on the GitHub label their workflow falls back to.
export const CiVariable = Schema.Struct({
  name: RunnerVariable,
  // The repository's own value, or null when it has none.
  value: Schema.NullOr(Schema.String),
  // The organization's value of the same name, which applies when the repository has none.
  org: Schema.NullOr(Schema.String),
});
export type CiVariable = typeof CiVariable.Type;

// Whether a repository's runner can be switched from here. `ready`: its variables were read.
// `approve`: its install's owner hasn't accepted the Variables permission on GitHub. `refused`:
// GitHub wouldn't say, which a user without write access to the repository gets. `nothing`: no
// job reads a runner variable yet.
export const CiSwitch = Schema.Literals(["ready", "approve", "refused", "nothing"]);
export type CiSwitch = typeof CiSwitch.Type;

export const CiRepo = Schema.Struct({
  repo: RepoName,
  jobs: Schema.Array(CiJob),
  // A unified diff for `git apply` that moves every `patched` job, or null when none is.
  patch: Schema.NullOr(Schema.String),
  // Why some jobs may be missing, such as a workflow that isn't valid YAML.
  problem: Schema.NullOr(Schema.String),
  switch: CiSwitch,
  // One for each variable a job reads, when `switch` is `ready`.
  variables: Schema.Array(CiVariable),
  // The install's page on GitHub, where `approve` is done.
  approveUrl: Schema.NullOr(Schema.String),
});
export type CiRepo = typeof CiRepo.Type;

export const MoveCiView = Schema.Struct({
  // Null when the server isn't signed in to GitHub.
  app: Schema.NullOr(GitHubAppName),
  // Repositories with at least one job, or a problem reading them.
  repos: Schema.Array(CiRepo),
  // Why the list may be out of date, such as GitHub not answering.
  problem: Schema.NullOr(Schema.String),
  // This machine's runner kinds, which a variable may be set to.
  runners: Schema.Array(CiRunner),
  // Whether this session may set a variable.
  canSwitch: Schema.Boolean,
});
export type MoveCiView = typeof MoveCiView.Type;

export class MoveCiError extends Schema.TaggedError<MoveCiError>()("MoveCiError", {
  reason: Schema.Literals(["not_signed_in", "not_installed", "not_read", "unknown_label", "needs_docker", "org_sets", "refused", "github_unreachable"]),
}) {
  override get message() {
    switch (this.reason) {
      case "not_signed_in":
        return "The server isn't signed in to GitHub.";
      case "not_installed":
        return "The App isn't installed on that repository.";
      case "not_read":
        return "No job on that repository reads that variable yet. Commit the patch first.";
      case "unknown_label":
        return "That isn't a runner on this machine.";
      case "needs_docker":
        return "A job that reads that variable needs Docker, and that runner doesn't have it.";
      case "org_sets":
        return "The organization sets that variable, so deleting the repository's wouldn't move the jobs to GitHub.";
      case "refused":
        return "GitHub refused. The install must accept the Variables permission on GitHub, and you need write access to the repository.";
      case "github_unreachable":
        return "The server couldn't get an answer from GitHub. Try again in a minute.";
    }
  }
}
