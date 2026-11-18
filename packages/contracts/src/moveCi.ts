import * as Schema from "effect/Schema";
import { GitHubAppName } from "./github.ts";
import { RepoName } from "./history.ts";

// Move CI: where each job on a repository the App is installed on picks its runner, read from the
// workflows on its default branch through the server's sign-in (github.ts). A job that names its
// runner through a repository variable moves when the variable changes, with no commit. For the
// rest, the server drafts the patch that makes them read it. It never writes to the repository.

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

export const CiRepo = Schema.Struct({
  repo: RepoName,
  jobs: Schema.Array(CiJob),
  // A unified diff for `git apply` that moves every `patched` job, or null when none is.
  patch: Schema.NullOr(Schema.String),
  // Why some jobs may be missing, such as a workflow that isn't valid YAML.
  problem: Schema.NullOr(Schema.String),
});
export type CiRepo = typeof CiRepo.Type;

export const MoveCiView = Schema.Struct({
  // Null when the server isn't signed in to GitHub.
  app: Schema.NullOr(GitHubAppName),
  // Repositories with at least one job, or a problem reading them.
  repos: Schema.Array(CiRepo),
  // Why the list may be out of date, such as GitHub not answering.
  problem: Schema.NullOr(Schema.String),
});
export type MoveCiView = typeof MoveCiView.Type;
