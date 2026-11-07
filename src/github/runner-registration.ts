import { type } from "arktype";
import { GITHUB_API, githubHeaders } from "./github-client.ts";

const Registration = type({ encoded_jit_config: "string" });

export type RunnerScope = { org: string } | { repo: string };

type RegistrationRequest = {
  scope: RunnerScope;
  token: string;
  runnerName: string;
  label: string;
};

// Asks GitHub for a registration that works for one job. Treat the result as a secret.
export async function mintRegistration({ scope, token, runnerName, label }: RegistrationRequest) {
  const owner = "org" in scope ? `orgs/${scope.org}` : `repos/${scope.repo}`;
  const response = await fetch(`${GITHUB_API}/${owner}/actions/runners/generate-jitconfig`, {
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
  return body.encoded_jit_config;
}
