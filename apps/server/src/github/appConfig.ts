// The GitHub App the server signs in through. Its client ID is public and is all the device flow
// needs; its slug is where it's installed from, github.com/apps/<slug>.
export type GitHubAppConfig = { readonly clientId: string; readonly slug: string; readonly name: string };

const SLUG = /^[\w-]{1,60}$/;

// Read from the environment `serve` starts with. Without both, the server has no sign-in to offer.
export function appFromEnv(env: NodeJS.ProcessEnv): { readonly app?: GitHubAppConfig } {
  const clientId = env.RUNNERBOX_GITHUB_APP_CLIENT_ID?.trim() ?? "";
  const slug = env.RUNNERBOX_GITHUB_APP_SLUG?.trim() ?? "";
  return /^[\w.]{1,60}$/.test(clientId) && SLUG.test(slug) ? { app: { clientId, slug, name: slug } } : {};
}
