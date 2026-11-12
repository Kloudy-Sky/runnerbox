import semver from "semver";

const RELEASES = "https://github.com/Kloudy-Sky/runnerbox/releases/download";

// Whether a server is older than this app. Only a released app can say: one built from a checkout
// is 0.0.0, and its servers are whatever their owner runs.
export const serverIsBehind = (appVersion: string, serverVersion: string) =>
  semver.valid(appVersion) !== null && appVersion !== "0.0.0" && semver.valid(serverVersion) !== null && semver.lt(serverVersion, appVersion);

// What updates a server to this app's own release, as deploy/runnerbox-serve.service installs it:
// fetch runnerbox.js and its sha256 from that release, check it, and restart the service.
export function serverUpdateCommand(appVersion: string) {
  const release = `${RELEASES}/v${appVersion}`;
  return `cd ~/runnerbox && curl -fsSL -O ${release}/runnerbox.js -O ${release}/runnerbox.js.sha256 && sha256sum -c runnerbox.js.sha256 && systemctl --user restart runnerbox-serve`;
}
