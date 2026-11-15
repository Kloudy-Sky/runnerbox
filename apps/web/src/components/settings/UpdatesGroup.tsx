import type { UpdateChannel, UpdateState } from "@runnerbox/client-runtime";
import semver from "semver";
import type { useDesktopUpdates } from "../../hooks/useDesktopUpdates.ts";
import { formatAge } from "../../lib/format.ts";
import { Button } from "../ui/button.tsx";
import { SettingsRow, SettingsSection } from "./settingsLayout.tsx";

type Updates = NonNullable<ReturnType<typeof useDesktopUpdates>>;

const CHANNELS: ReadonlyArray<readonly [UpdateChannel, string]> = [
  ["stable", "Stable"],
  ["nightly", "Nightly"],
];

// What the updater is doing, in a line. A nightly newer than the latest stable waits for the next
// stable rather than going back to it.
function statusWords(state: UpdateState) {
  switch (state.status) {
    case "disabled":
    case "error":
      return state.message ?? "";
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking.";
    case "downloading":
      return `Downloading ${state.pending}.`;
    case "ready":
      return `${state.pending} is downloaded. It installs when the app restarts.`;
    case "up-to-date":
      return state.latest !== null && semver.valid(state.latest) && semver.valid(state.version) && semver.lt(state.latest, state.version)
        ? `This build is newer than the latest ${state.channel}, ${state.latest}. The next ${state.channel} release updates it.`
        : `Up to date. Checked ${formatAge(state.checkedAt)} ago.`;
  }
}

// The desktop app's own updates, in About: which channel it follows, and what it's doing.
export function UpdatesGroup({ updates }: { updates: Updates }) {
  const { state, actions } = updates;
  const busy = state.status === "checking" || state.status === "downloading";
  return (
    <SettingsSection title="Updates">
      <SettingsRow
        title="Channel"
        description="Stable gets each release. Nightly gets a build of the latest changes, most days."
        control={CHANNELS.map(([channel, label]) => (
          <Button key={channel} size="sm" variant={state.channel === channel ? "secondary" : "ghost-muted"} onClick={() => void actions.setChannel(channel)}>
            {label}
          </Button>
        ))}
      />
      <SettingsRow
        title="Status"
        description={statusWords(state)}
        control={
          state.status === "ready" ? (
            <Button size="sm" onClick={() => void actions.install()}>
              Restart to update
            </Button>
          ) : state.status !== "disabled" ? (
            <Button size="sm" variant="ghost-muted" disabled={busy} onClick={() => void actions.check()}>
              Check now
            </Button>
          ) : null
        }
      />
    </SettingsSection>
  );
}
