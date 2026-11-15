import type { SavedEnvironment } from "@runnerbox/client-runtime";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useStore } from "zustand";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";
import type { RootSearch } from "../lib/search.ts";
import { BLOCKED_WORDS, isUnderway, needsCommand, underwayLine, type UpdateRun } from "../lib/serverUpdate.ts";
import { runtime } from "../runtime.ts";
import { dismissUpdate, startUpdate, useServerUpdates } from "../state/serverUpdates.ts";
import { ServerUpdateCommand } from "./ServerUpdateCommand.tsx";
import { Button } from "./ui/button.tsx";

const NOTICE = "mx-3 flex shrink-0 flex-col gap-1 rounded-lg bg-surface px-3 py-1.5";

// Whether this device may update the server, and if not, the one line that says why. A Connect
// session only reads; a device paired without `access:write` can't manage the server.
export function useUpdateAccess(environment: SavedEnvironment) {
  const route = useStore(runtime.store, (state) => {
    const connection = state.connections[environment.environmentId];
    return connection?.status === "connected" ? connection.route : undefined;
  });
  if (route?.kind === "connect") return "Updating needs a device paired by address or SSH. Connect only reads.";
  if (!environment.scopes.includes("access:write")) return "This device was paired without the right to manage the server, so it can't update it.";
  return null;
}

export const useUpdateRun = (environmentId: string) => useServerUpdates((state) => state.runs[environmentId]);

// The line for an update this app started, from the click to how it ended.
export function UpdateRunNotice({ environment, run, appVersion }: { environment: SavedEnvironment; run: UpdateRun; appVersion: string }) {
  const environmentId = environment.environmentId;
  if (isUnderway(run)) {
    return (
      <div className={NOTICE}>
        <span>{underwayLine(run, environment.label)}</span>
        {run.step === "downloading" && run.total !== null ? (
          <span className="block h-0.5 overflow-hidden rounded-full bg-secondary">
            <span className="block h-full bg-foreground" style={{ width: `${Math.round((run.received / run.total) * 100)}%` }} />
          </span>
        ) : null}
      </div>
    );
  }
  const dismiss = (
    <Button variant="ghost-muted" size="icon-xs" aria-label="Dismiss" onClick={() => dismissUpdate(environmentId)}>
      <X />
    </Button>
  );
  const retry = (
    <Button variant="secondary" size="xs" onClick={() => void startUpdate(environmentId, appVersion)}>
      Try again
    </Button>
  );
  if (run.step === "done") {
    return (
      <div className={NOTICE}>
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <span className="text-success">Done, now on {run.version}.</span> <span className="text-muted-foreground">Runners move to it when they restart.</span>
          </span>
          <Link to="/settings/about" search={(previous: RootSearch) => previous} className="text-foreground text-xs underline underline-offset-2">
            Runners
          </Link>
          {dismiss}
        </div>
      </div>
    );
  }
  const [headline, detail] =
    run.step === "rolled-back"
      ? ["The new version didn't start, so the old one is running again.", run.reason]
      : run.step === "lost"
        ? [`The server on ${environment.label} hasn't come back yet. It may still be starting.`, null]
        : ["The update didn't start.", run.detail];
  return (
    <div className={NOTICE}>
      <div className="flex items-center gap-3">
        <span className={run.step === "lost" ? "flex-1" : "flex-1 text-destructive"}>{headline}</span>
        {run.step === "lost" ? null : retry}
        {dismiss}
      </div>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

// A connected server older than this app: Update when it can update itself, the command when
// it's too old to, and the reason when something holds it back.
export function ServerBehindNotice({ environment, serverVersion, appVersion }: { environment: SavedEnvironment; serverVersion: string; appVersion: string }) {
  const capabilities = useServerCapabilities();
  const denied = useUpdateAccess(environment);
  const status = useRpcQuery(["server.updateStatus"], (client) => client["server.updateStatus"](), { enabled: capabilities.serverUpdate && denied === null });
  const behind = `The server on ${environment.label} runs Runnerbox ${serverVersion}, older than this app (${appVersion}).`;
  if (!capabilities.serverUpdate) {
    return (
      <div className={NOTICE}>
        <span>The server on {environment.label} runs Runnerbox {serverVersion}, too old to update from here. Run this on that machine once. After that, Update works from this app.</span>
        <ServerUpdateCommand appVersion={appVersion} />
      </div>
    );
  }
  const blocker = status.data?.blocker ?? null;
  const why = denied ?? (blocker === null ? null : BLOCKED_WORDS[blocker]);
  return (
    <div className={NOTICE}>
      <div className="flex items-center gap-3">
        <span className="flex-1">{behind}</span>
        {blocker === "checkout" ? null : (
          <Button size="xs" disabled={why !== null || !status.isSuccess} onClick={() => void startUpdate(environment.environmentId, appVersion)}>
            Update
          </Button>
        )}
      </div>
      {why ? <span className="text-muted-foreground">{why}</span> : null}
      {denied === null && needsCommand(blocker) ? <ServerUpdateCommand appVersion={appVersion} /> : null}
    </div>
  );
}
