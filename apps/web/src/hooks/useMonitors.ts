import type { MonitorSettings } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

// The environment's monitor: its settings, today's looks and what they cost, recent runs, and items
// it looked into that the owner hasn't opened. Asked again each minute, since it runs on its own,
// and as soon as a look in progress ends.
export function useMonitors() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const queryClient = useQueryClient();
  const status = useRpcQuery(["monitors"], (client) => client["monitors.status"](), 60_000);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [environmentId, "monitors"] });
  const looking = status.data?.runs.find((run) => run.outcome === "running")?.threadId ?? null;
  // Following the look's thread is synchronizing with something outside React. A snapshot that
  // ends in TurnEnded means the look is over but the status hadn't caught up when it was fetched,
  // so subscribing again after each fetch asks until it has.
  const fetchedAt = status.dataUpdatedAt;
  useEffect(() => {
    if (looking === null) return;
    return runtime.follow(environmentId, (client) => client["threads.subscribe"]({ id: looking }), (event) => {
      if (event._tag === "TurnEnded" || (event._tag === "Snapshot" && event.detail.items.at(-1)?._tag === "TurnEnded")) {
        void queryClient.invalidateQueries({ queryKey: [environmentId, "monitors"] });
      }
    });
  }, [environmentId, looking, fetchedAt, queryClient]);
  return {
    status: status.data ?? null,
    save: (settings: MonitorSettings) => runtime.run(environmentId, (client) => client["monitors.save"](settings)).finally(refresh),
    markRead: (itemId: string) => runtime.run(environmentId, (client) => client["monitors.markRead"]({ itemId })).finally(refresh),
  };
}
