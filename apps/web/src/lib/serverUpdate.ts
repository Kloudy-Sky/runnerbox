import type { InstallState, UpdateBlocker, UpdateOutcome } from "@runnerbox/contracts";
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

// An update the app asked for, from the click until it knows how it ended. `starting` lasts
// through the restart and the reconnect after it.
export type UpdateRun =
  | { readonly step: "downloading"; readonly version: string; readonly received: number; readonly total: number | null }
  | { readonly step: "checking"; readonly version: string }
  | { readonly step: "starting"; readonly version: string; readonly updateId: string }
  | { readonly step: "done"; readonly version: string }
  | { readonly step: "rolled-back"; readonly version: string; readonly reason: string | null }
  // It didn't start: the server said why, with the old version still serving.
  | { readonly step: "refused"; readonly version: string; readonly detail: string }
  // The server hasn't come back in the time an update takes.
  | { readonly step: "lost"; readonly version: string };

export const isUnderway = (run: UpdateRun | undefined) => run !== undefined && (run.step === "downloading" || run.step === "checking" || run.step === "starting");

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

// The one line the notice shows while an update runs.
export function underwayLine(run: UpdateRun, label: string) {
  const updating = `Updating ${label} to ${run.version}.`;
  if (run.step === "downloading") return run.total === null ? `${updating} Downloading.` : `${updating} Downloading, ${megabytes(run.received)} of ${megabytes(run.total)} MB.`;
  if (run.step === "checking") return `${updating} Checking it.`;
  return `${updating} Starting the new version.`;
}

// What stops an update now, and what to do about it, as the server says when it refuses one.
export const BLOCKED_WORDS: Record<UpdateBlocker, string> = {
  checkout: "This server was built from a checkout, so it has no releases to update from.",
  unsupervised: "This server wasn't started with runnerbox serve, so it can't restart itself on a new version. Update it on that machine:",
  "not-writable": "This server can't replace its own runnerbox.js, because its folder isn't writable. Update it on that machine:",
  updating: "An update is already running.",
  "turn-running": "The agent is answering in a thread. Stop it, then update.",
  "monitor-running": "A monitor is looking into an item, which counts as an agent's turn. Stop it in that item's thread, then update.",
  "reproduce-running": "A reproduce container is running. Stop it in its thread, then update.",
};

// A blocker the app can't clear from here, so the command is the way to update.
export const needsCommand = (blocker: UpdateBlocker | null) => blocker === "unsupervised" || blocker === "not-writable";

export type StaleInstall = { readonly install: string; readonly host: boolean };

// The installs still running the code an update replaced: those whose runners started before it
// finished. An install that runs jobs on the machine's own OS needs its setup run again, by hand.
export function staleInstalls(installs: ReadonlyArray<InstallState>, lastUpdate: UpdateOutcome | null): ReadonlyArray<StaleInstall> {
  if (lastUpdate?.status !== "committed" || lastUpdate.finishedAt === undefined) return [];
  const updatedAt = Date.parse(lastUpdate.finishedAt);
  return installs
    .filter((state) => !state.stale && Date.parse(state.startedAt) < updatedAt)
    .map((state) => ({ install: state.install, host: state.kinds.some((kind) => kind.runsIn === "host") }));
}

// The install's name comes from the server, so it's quoted for the shell whatever it holds.
export const restartCommand = (install: string) => `systemctl --user restart '${`runnerbox@${install}`.replaceAll("'", `'\\''`)}'`;
