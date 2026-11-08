import { type } from "arktype";
import { GITHUB_API, githubHeaders } from "./github-client.ts";

const Registration = type({ encoded_jit_config: "string", runner: { id: "number" } });

export type RunnerScope = { org: string } | { repo: string };

type RegistrationRequest = {
  scope: RunnerScope;
  token: string;
  runnerName: string;
  label: string;
};

const runnersPath = (scope: RunnerScope) =>
  `${GITHUB_API}/${"org" in scope ? `orgs/${scope.org}` : `repos/${scope.repo}`}/actions/runners`;

// Asks GitHub for a registration that works for one job. Treat `jitConfig` as a secret.
export async function mintRegistration({ scope, token, runnerName, label }: RegistrationRequest) {
  const response = await fetch(`${runnersPath(scope)}/generate-jitconfig`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      name: runnerName,
      runner_group_id: 1,
      labels: ["self-hosted", label],
      work_folder: "_work",
    }),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

  const body = Registration(await response.json());
  if (body instanceof type.errors) throw new Error("GitHub's response had no registration");
  return { runnerId: body.runner.id, jitConfig: body.encoded_jit_config };
}

// Removes a runner that hasn't taken a job yet. GitHub refuses to remove one that is running a job.
export async function removeRunner({ scope, token, runnerId }: { scope: RunnerScope; token: string; runnerId: number }) {
  const response = await fetch(`${runnersPath(scope)}/${runnerId}`, { method: "DELETE", headers: githubHeaders(token) });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
}
