import { useAtomValue } from "@effect/atom-react";
import type { SavedEnvironment } from "@runnerbox/client-runtime";
import { useState } from "react";
import type { UpdateOutcome } from "@runnerbox/contracts";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";
import { useRunnerState } from "../../hooks/useRunnerState.ts";
import { useServerCapabilityState } from "../../hooks/useServerCapabilities.ts";
import { answerOf } from "../../lib/answer.ts";
import { BLOCKED_WORDS, isUnderway, needsCommand, RESTART_WORDS, restartCommand, restartedInstalls, serverIsBehind, SIGNATURE_WORDS, staleInstalls, underwayLine } from "../../lib/serverUpdate.ts";
import { appAtomRegistry } from "../../rpc/atomRegistry.ts";
import { runtime } from "../../runtime.ts";
import { restartStatusAtom, updateStatusAtom } from "../../state/serverStatus.ts";
import { startUpdate } from "../../state/serverUpdates.ts";
import { ServerUpdateCommand } from "../ServerUpdateCommand.tsx";
import { useReleaseSignature, useUpdateAccess, useUpdateRun } from "../ServerUpdateNotice.tsx";
import { Button } from "../ui/button.tsx";
import { SettingsRow, SettingsSection } from "./settingsLayout.tsx";

const clock = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const useUpdateStatus = (environment: SavedEnvironment) => {
  const { capabilities, known } = useServerCapabilityState();
  const denied = useUpdateAccess(environment);
  const status = answerOf(useAtomValue(updateStatusAtom(denied === null ? environment.environmentId : "")));
  return { capable: capabilities.serverUpdate, known, denied, status };
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
  const { capable, known, denied, status } = useUpdateStatus(environment);
  const run = useUpdateRun(environment.environmentId);
  const behind = serverIsBehind(appVersion, serverVersion);
  const unsigned = useReleaseSignature(appVersion, capable && denied === null && behind);
  if (!known) return null;
  const last = status.data?.lastUpdate ?? null;
  if (!capable) return behind ? <ServerUpdateCommand appVersion={appVersion} /> : null;
  if (behind && (unsigned === "missing" || unsigned === "invalid")) {
    return (
      <div className="flex flex-col gap-1.5 pb-2">
        {last ? <LastUpdate last={last} /> : null}
        <p className="text-muted-foreground text-xs">{SIGNATURE_WORDS[unsigned]}</p>
        {unsigned === "missing" ? <ServerUpdateCommand appVersion={appVersion} /> : null}
      </div>
    );
  }
  const blocker = status.data?.blocker ?? null;
  const why = denied ?? (blocker === null ? null : BLOCKED_WORDS[blocker]);
  const tried = last?.status === "rolled-back" && last.to === appVersion;
  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {last ? <LastUpdate last={last} /> : null}
      {run && isUnderway(run) ? <p className="text-xs">{underwayLine(run, environment.label)}</p> : null}
      {behind && !(run && isUnderway(run)) && blocker !== "checkout" ? (
        <div className="flex items-center gap-3">
          <Button size="xs" variant={tried || why !== null ? "secondary" : "default"} disabled={why !== null || !status.isSuccess || unsigned === "pending"} onClick={() => void startUpdate(environment.environmentId, appVersion)}>
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

// How one install's runners move to the new version: from here, when the server can ask its
// Runnerbox, or with the command when it can't.
function RestartControl({ environment, install, version, updatedAt }: { environment: SavedEnvironment; install: string; version: string; updatedAt: string }) {
  const { capabilities } = useServerCapabilityState();
  const denied = useUpdateAccess(environment);
  const asking = capabilities.restartRunners && denied === null;
  // Not asking reads no machine, which never asks.
  const statusAtom = restartStatusAtom({ environmentId: asking ? environment.environmentId : "", install });
  const status = answerOf(useAtomValue(statusAtom));
  const [refused, setRefused] = useState<string | null>(null);
  const command = <CopyCommand command={restartCommand(install)} />;
  const restart = status.data;
  if (!asking || restart === undefined || !restart.available) {
    return (
      <span className="flex flex-col items-end gap-1">
        {command}
        {restart?.unavailable ? <span className="text-muted-foreground text-xs">{restart.unavailable}</span> : null}
      </span>
    );
  }
  if (restart.waiting) return <span className="max-w-md text-right text-muted-foreground text-xs">{RESTART_WORDS.waiting(version)}</span>;
  const ask = () =>
    void runtime.run(environment.environmentId, (client) => client["runners.restartWhenIdle"]({ install })).then(
      () => appAtomRegistry.refresh(statusAtom),
      (error: unknown) => setRefused(error instanceof Error ? error.message : "That didn't work."),
    );
  // Only a restart asked for since this update counts; an older one was for another version.
  const gaveUp = restart.last?.outcome === "not_restarted" && restart.last.reason === "no moment without a running job came in 6 hours" && Date.parse(restart.last.at) > Date.parse(updatedAt);
  return (
    <span className="flex max-w-md flex-col items-end gap-1 text-right">
      {gaveUp ? (
        <>
          <span className="text-muted-foreground text-xs">{RESTART_WORDS.notIdle}</span>
          {command}
        </>
      ) : null}
      <Button variant="secondary" size="xs" onClick={ask}>
        {RESTART_WORDS.ask}
      </Button>
      {refused ? <span className="text-muted-foreground text-xs">{refused}</span> : null}
    </span>
  );
}

// The runners still on the code the last update replaced, and how each moves to the new one, then
// those that have since restarted onto it.
export function StaleRunnersSettings({ environment }: { environment: SavedEnvironment }) {
  const { status } = useUpdateStatus(environment);
  const installs = useRunnerState();
  const last = status.data?.lastUpdate ?? null;
  const stale = staleInstalls(installs ?? [], last);
  const restarted = restartedInstalls(installs ?? [], last);
  if (last === null || (stale.length === 0 && restarted.length === 0)) return null;
  return (
    <SettingsSection title={`Runners on ${environment.label}`}>
      {stale.length > 0 ? (
        <p className="px-3 pt-3 text-muted-foreground text-xs sm:px-4">
          These started before the update, so they still run {last.from}. A restart lets running jobs finish first.
        </p>
      ) : null}
      {stale.map(({ install, host }) => (
        <SettingsRow
          key={install}
          title={<span className="font-normal">{install}</span>}
          className="py-2"
          control={
            host ? (
              <span className="max-w-md text-right text-muted-foreground text-xs">Runs jobs on the Mac's own OS, so its setup has to run again with sudo after an update. That needs someone at the machine.</span>
            ) : (
              <RestartControl environment={environment} install={install} version={last.to} updatedAt={last.finishedAt ?? last.startedAt} />
            )
          }
        />
      ))}
      {restarted.map(({ install, at }) => (
        <SettingsRow
          key={install}
          title={<span className="font-normal">{install}</span>}
          className="py-2"
          control={
            <span className="text-muted-foreground text-xs">
              Restarted {clock(at)}, now on {last.to}.
            </span>
          }
        />
      ))}
    </SettingsSection>
  );
}
