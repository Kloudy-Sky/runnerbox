import { Link } from "@tanstack/react-router";
import packageJson from "../../package.json" with { type: "json" };
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { serverIsBehind } from "../lib/serverUpdate.ts";
import { ServerUpdateCommand } from "./ServerUpdateCommand.tsx";
import { Button } from "./ui/button.tsx";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { queryClient, runtime } from "../runtime.ts";
import type { RootSearch } from "../lib/search.ts";

const APP_VERSION = packageJson.version;

// Shown while the active environment is offline, or runs a server older than this app. Whatever
// was loaded stays on screen below it.
export function ConnectionNotice() {
  const { environment, connection } = useActiveEnvironment();
  const about = useRpcQuery(["about"], (client) => client["server.about"]());
  const serverVersion = about.data?.serverVersion ?? null;
  if (environment && connection?.status === "connected" && serverVersion !== null && serverIsBehind(APP_VERSION, serverVersion)) {
    return (
      <div className="mx-3 flex shrink-0 flex-col gap-1.5 rounded-lg bg-surface px-3 py-2">
        <span>
          The server on {environment.label} runs runnerbox {serverVersion}, older than this app ({APP_VERSION}). Update it on that machine. Its installs pick up the same file when they next restart:
        </span>
        <ServerUpdateCommand appVersion={APP_VERSION} />
      </div>
    );
  }
  if (!environment || connection?.status !== "disconnected") return null;
  const cached = queryClient.getQueryCache().findAll({ queryKey: [environment.environmentId] }).some((query) => query.state.data !== undefined);
  return (
    <div className="mx-3 flex shrink-0 flex-col gap-1.5 rounded-lg bg-surface px-3 py-1.5">
      <div className="flex items-center gap-3">
        <span className="text-destructive">{connection.message}</span>
        <span className="text-muted-foreground">
          {connection.retryAt === null ? "Not retrying." : "Retrying on its own."}
          {cached ? " Showing what was loaded before." : ""}
        </span>
        <span className="flex-1" />
        {connection.reason === "unauthorized" ? (
          <Link to="/settings/connections" search={(previous: RootSearch) => previous} className="text-foreground">
            Forget it and pair again
          </Link>
        ) : (
          <Button variant="secondary" size="xs" onClick={() => runtime.reconnect(environment.environmentId)}>
            Retry now
          </Button>
        )}
      </div>
      {connection.reason === "incompatible" && APP_VERSION !== "0.0.0" ? (
        <>
          <span className="text-muted-foreground">If the server is older than this app, update it on that machine, then retry. If it's newer, update this app in Settings, About.</span>
          <ServerUpdateCommand appVersion={APP_VERSION} />
        </>
      ) : null}
    </div>
  );
}
