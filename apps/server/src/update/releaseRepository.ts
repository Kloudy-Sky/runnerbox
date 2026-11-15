// The repository whose releases this build came from, as owner/name, or null for a build from a
// checkout. scripts/build.ts writes it in; nothing at run time, such as an environment variable,
// can name another.
declare const RUNNERBOX_RELEASE_REPO: string | undefined;

export const releaseRepository: string | null = typeof RUNNERBOX_RELEASE_REPO === "string" ? RUNNERBOX_RELEASE_REPO : null;
