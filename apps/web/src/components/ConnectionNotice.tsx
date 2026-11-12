import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button.tsx";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { queryClient, runtime } from "../runtime.ts";
import type { RootSearch } from "../lib/search.ts";

// Shown while the active environment is offline. Whatever was loaded stays on screen below it.
export function ConnectionNotice() {
  const { environment, connection } = useActiveEnvironment();
  if (!environment || connection?.status !== "disconnected") return null;
  const cached = queryClient.getQueryCache().findAll({ queryKey: [environment.environmentId] }).some((query) => query.state.data !== undefined);
  return (
    <div className="mx-3 flex shrink-0 items-center gap-3 rounded-lg bg-surface px-3 py-1.5">
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
  );
}
