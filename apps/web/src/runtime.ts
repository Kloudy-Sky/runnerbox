import { createClientRuntime } from "@runnerbox/client-runtime";
import { QueryClient } from "@tanstack/react-query";
import { platform } from "./platform.ts";

export const runtime = createClientRuntime(platform);

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchInterval: 60_000, retry: 1 } },
});

// A connection that comes back refreshes what that environment's views show. Data from before the
// drop stays on screen meanwhile, marked as disconnected by the top bar.
runtime.store.subscribe((state, previous) => {
  for (const [environmentId, connection] of Object.entries(state.connections)) {
    if (connection.status === "connected" && previous.connections[environmentId]?.status !== "connected") {
      void queryClient.invalidateQueries({ queryKey: [environmentId] });
    }
  }
});
