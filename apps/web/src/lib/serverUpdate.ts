import semver from "semver";

// owner/name, so it can sit in a shell command as it is.
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// The repository this build's releases come from, set at build time, or null when there's none.
export const releaseRepository = (value: string | undefined) => (value && REPOSITORY.test(value) ? value : null);

// Whether a server is older than this app. Only a released app can say: one built from a checkout
// is 0.0.0, and its servers are whatever their owner runs.
export const serverIsBehind = (appVersion: string, serverVersion: string) =>
  semver.valid(appVersion) !== null && appVersion !== "0.0.0" && semver.valid(serverVersion) !== null && semver.lt(serverVersion, appVersion);

// What updates a server to this app's own release, from the repository this app was released
// from, as deploy/runnerbox-serve.service installs it.
// It downloads into a temporary directory and checks the sha256 there, so a bad download never
// replaces the file a restart would run; the swap into ~/runnerbox is a rename. Its own shell, so
// `set -e` doesn't stay on in the owner's.
export function serverUpdateCommand(repository: string, appVersion: string) {
  if (!semver.valid(appVersion)) throw new Error(`${appVersion} isn't a version.`);
  if (releaseRepository(repository) === null) throw new Error(`${repository} isn't owner/name.`);
  const release = `https://github.com/${repository}/releases/download/v${appVersion}`;
  return [
    "bash -c 'set -euo pipefail",
    'tmp="$(mktemp -d)"',
    'trap "rm -rf \\"$tmp\\"" EXIT',
    'cd "$tmp"',
    `curl -fsSL -O "${release}/runnerbox.js" -O "${release}/runnerbox.js.sha256"`,
    "sha256sum -c runnerbox.js.sha256",
    'cp runnerbox.js "$HOME/runnerbox/runnerbox.js.new"',
    'mv "$HOME/runnerbox/runnerbox.js.new" "$HOME/runnerbox/runnerbox.js"',
    "systemctl --user restart runnerbox-serve'",
  ].join("; ");
}
