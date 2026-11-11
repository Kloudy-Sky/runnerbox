import { type } from "arktype";
import { GITHUB_API, githubHeaders } from "./github-client.ts";
import { DEFAULT_RUNNER_GROUP_ID, type RunnerScope } from "./runner-registration.ts";

const Repository = type({ private: "boolean" });
const RunnerGroup = type({ allows_public_repositories: "boolean" });
// Long enough for a slow GitHub, short enough that a hung request refuses rather than stalls a slot.
const LOOKUP_TIMEOUT_MS = 30_000;

// Throws if a public repository could send jobs to runners minted for this scope, because anyone
// can open a pull request there that runs their code. Also throws if GitHub doesn't confirm it
// either way, so a failed lookup never starts a runner.
export async function refusePublicScope(scope: RunnerScope, token: string) {
  if ("repo" in scope) {
    const repository = Repository(await lookUp(`repos/${scope.repo}`, token));
    if (repository instanceof type.errors) throw new Error(`GitHub didn't say whether ${scope.repo} is public`);
    if (repository.private) return;
    throw new Error(`${scope.repo} is public, so anyone could run code here with a pull request. Set allowPublicRepos to run it anyway.`);
  }

  // Runners are minted into the default group, so that group's setting decides.
  const group = RunnerGroup(await lookUp(`orgs/${scope.org}/actions/runner-groups/${DEFAULT_RUNNER_GROUP_ID}`, token));
  if (group instanceof type.errors) throw new Error(`GitHub didn't say whether ${scope.org}'s runner group allows public repositories`);
  if (!group.allows_public_repositories) return;
  throw new Error(
    `${scope.org}'s default runner group allows public repositories, so anyone could run code here with a pull request. Turn that off in the group's settings, or set allowPublicRepos to run it anyway.`,
  );
}

async function lookUp(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${GITHUB_API}/${path}`, { headers: githubHeaders(token), signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }).catch(() => {
    throw new Error("Could not check for public repositories: GitHub didn't answer");
  });
  if (!response.ok) throw new Error(`Could not check for public repositories: GitHub returned ${response.status}`);
  return response.json();
}
