// The GitHub App the server signs in through. Its client ID is public and is all the device flow
// needs; its slug is where it's installed from, github.com/apps/<slug>.
export type GitHubAppConfig = { readonly clientId: string; readonly slug: string; readonly name: string };

// Runnerbox's own App, which every install shares.
const RUNNERBOX_APP: GitHubAppConfig = { clientId: "Iv23licuN4LtFd9O3teG", slug: "runnerbox-for-github", name: "Runnerbox for GitHub" };

const CLIENT_ID = /^[\w.]{1,60}$/;
const SLUG = /^[\w-]{1,60}$/;

// Runnerbox's App, unless the environment `serve` starts with names another by both its client ID
// and slug, as a fork with its own App would.
export function appFromEnv(env: NodeJS.ProcessEnv): GitHubAppConfig {
  const clientId = env.RUNNERBOX_GITHUB_APP_CLIENT_ID?.trim() ?? "";
  const slug = env.RUNNERBOX_GITHUB_APP_SLUG?.trim() ?? "";
  return CLIENT_ID.test(clientId) && SLUG.test(slug) ? { clientId, slug, name: slug } : RUNNERBOX_APP;
}
