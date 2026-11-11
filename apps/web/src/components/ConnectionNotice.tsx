import { Link } from "@tanstack/react-router";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { queryClient, runtime } from "../runtime.ts";
import type { RootSearch } from "../lib/search.ts";

// Shown while the active environment is offline. Whatever was loaded stays on screen below it.
export function ConnectionNotice() {
  const { environment, connection } = useActiveEnvironment();
  if (!environment || connection?.status !== "disconnected") return null;
  const cached = queryClient.getQueryCache().findAll({ queryKey: [environment.environmentId] }).some((query) => query.state.data !== undefined);
  return (
    <div className="flex shrink-0 items-center gap-3 bg-surf2 px-3 py-1">
      <span className="text-red">{connection.message}</span>
      <span className="text-dim">
        {connection.retryAt === null ? "Not retrying." : "Retrying on its own."}
        {cached ? " Showing what was loaded before." : ""}
      </span>
      <span className="flex-1" />
      {connection.reason === "unauthorized" ? (
        <Link to="/connect" search={(previous: RootSearch) => previous} className="text-fg">
          Pair again
        </Link>
      ) : (
        <button type="button" className="text-fg" onClick={() => runtime.reconnect(environment.environmentId)}>
          Retry now
        </button>
      )}
    </div>
  );
}
