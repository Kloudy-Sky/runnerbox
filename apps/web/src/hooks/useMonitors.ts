import type { MonitorSettings } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

// The environment's monitor: its settings, today's looks and what they cost, recent runs, and items
// it looked into that the owner hasn't opened. Asked again each minute, since it runs on its own.
export function useMonitors() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const queryClient = useQueryClient();
  const status = useRpcQuery(["monitors"], (client) => client["monitors.status"](), 60_000);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [environmentId, "monitors"] });
  return {
    status: status.data ?? null,
    save: (settings: MonitorSettings) => runtime.run(environmentId, (client) => client["monitors.save"](settings)).finally(refresh),
    markRead: (itemId: string) => runtime.run(environmentId, (client) => client["monitors.markRead"]({ itemId })).finally(refresh),
  };
}
