import type { SavedEnvironment } from "@runnerbox/client-runtime";
import type { UpdateOutcome } from "@runnerbox/contracts";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { useRunnerState } from "../../hooks/useRunnerState.ts";
import { useServerCapabilities } from "../../hooks/useServerCapabilities.ts";
import { BLOCKED_WORDS, isUnderway, needsCommand, restartCommand, serverIsBehind, staleInstalls, underwayLine } from "../../lib/serverUpdate.ts";
import { startUpdate } from "../../state/serverUpdates.ts";
import { ServerUpdateCommand } from "../ServerUpdateCommand.tsx";
import { useUpdateAccess, useUpdateRun } from "../ServerUpdateNotice.tsx";
import { Button } from "../ui/button.tsx";
import { SettingsRow, SettingsSection } from "./settingsLayout.tsx";

const clock = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const useUpdateStatus = (environment: SavedEnvironment) => {
  const capabilities = useServerCapabilities();
  const denied = useUpdateAccess(environment);
  const status = useRpcQuery(["server.updateStatus"], (client) => client["server.updateStatus"](), { enabled: capabilities.serverUpdate && denied === null });
  return { capable: capabilities.serverUpdate, denied, status };
};

// How the last update went, in a line.
function LastUpdate({ last }: { last: UpdateOutcome }) {
  if (last.status === "pending") return null;
  if (last.status === "committed") return <p className="text-muted-foreground text-xs">Updated from {last.from} on {clock(last.finishedAt ?? last.startedAt)}. Done.</p>;
  return (
    <p className="text-xs">
      <span className="text-destructive">
        Tried {last.to} on {clock(last.finishedAt ?? last.startedAt)}. The new version didn't start, so the old one is running again.
      </span>{" "}
      {last.reason ? <span className="text-muted-foreground">{last.reason}</span> : null}
    </p>
  );
}

// Under the server's version in About: the last update, and Update when the server is behind.
export function ServerUpdateControls({ environment, serverVersion, appVersion }: { environment: SavedEnvironment; serverVersion: string; appVersion: string }) {
  const { capable, denied, status } = useUpdateStatus(environment);
  const run = useUpdateRun(environment.environmentId);
  const behind = serverIsBehind(appVersion, serverVersion);
  const last = status.data?.lastUpdate ?? null;
  if (!capable) return behind ? <ServerUpdateCommand appVersion={appVersion} /> : null;
  const blocker = status.data?.blocker ?? null;
  const why = denied ?? (blocker === null ? null : BLOCKED_WORDS[blocker]);
  const tried = last?.status === "rolled-back" && last.to === appVersion;
  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {last ? <LastUpdate last={last} /> : null}
      {run && isUnderway(run) ? <p className="text-xs">{underwayLine(run, environment.label)}</p> : null}
      {behind && !(run && isUnderway(run)) && blocker !== "checkout" ? (
        <div className="flex items-center gap-3">
          <Button size="xs" variant={tried ? "secondary" : "default"} disabled={why !== null || !status.isSuccess} onClick={() => void startUpdate(environment.environmentId, appVersion)}>
            {tried ? "Try again" : `Update to ${appVersion}`}
          </Button>
          {why ? <span className="text-muted-foreground text-xs">{why}</span> : null}
        </div>
      ) : behind && why ? (
        <p className="text-muted-foreground text-xs">{why}</p>
      ) : null}
      {behind && denied === null && needsCommand(blocker) ? <ServerUpdateCommand appVersion={appVersion} /> : null}
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <span className="flex items-center gap-2">
      <code className="rounded-md bg-surface px-2 py-0.5 font-mono text-[12px] text-muted-foreground">{command}</code>
      <Button variant="secondary" size="xs" onClick={() => copyToClipboard(command, undefined)}>
        {isCopied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

// The runners still on the code the last update replaced, and how each moves to the new one.
export function StaleRunnersSettings({ environment }: { environment: SavedEnvironment }) {
  const { status } = useUpdateStatus(environment);
  const installs = useRunnerState();
  const last = status.data?.lastUpdate ?? null;
  const stale = staleInstalls(installs ?? [], last);
  if (last === null || stale.length === 0) return null;
  return (
    <SettingsSection title={`Runners on ${environment.label}`}>
      <p className="px-3 pt-3 text-muted-foreground text-xs sm:px-4">
        These started before the update, so they still run {last.from}. A restart lets running jobs finish first.
      </p>
      {stale.map(({ install, host }) => (
        <SettingsRow
          key={install}
          title={<span className="font-normal">{install}</span>}
          className="py-2"
          control={
            host ? (
              <span className="max-w-md text-right text-muted-foreground text-xs">Runs jobs on the Mac's own OS, so its setup has to run again with sudo after an update. That needs someone at the machine.</span>
            ) : (
              <CopyCommand command={restartCommand(install)} />
            )
          }
        />
      ))}
    </SettingsSection>
  );
}
