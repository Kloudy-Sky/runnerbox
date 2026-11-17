import type { QueueView } from "@runnerbox/contracts";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { capabilitiesOf } from "../lib/serverCapabilities.ts";
import { queryClient, runtime } from "../runtime.ts";
import { methodsQuery } from "./useServerCapabilities.ts";

// Whether a connected machine's server has said it can push its queue, read from the cache, for
// the effect that follows it.
const hasQueue = (environmentId: string, since: number) => {
  const methods = queryClient.getQueryData(methodsQuery(environmentId, since).queryKey);
  return methods !== undefined && capabilitiesOf(methods).waitingJobs;
};

// The jobs GitHub has queued for each saved machine's runners, pushed by its server, keyed by the
// machine's environment id. Watching is what makes a server ask GitHub, so only a view that shows
// them should call this. A machine appears with its first push; one too old to have the queue
// never does.
export function useRunnerQueueEverywhere() {
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  // Asks each server what it can do, and renders again as each answers.
  const methods = useQueries({
    queries: environments.map((environment) => {
      const connection = connections[environment.environmentId];
      return methodsQuery(environment.environmentId, connection?.status === "connected" ? connection.since : null);
    }),
  });
  // Which machines can be followed, and since when, as one value: following restarts only when
  // that changes. Built from the answers React holds, so it changes as each server answers.
  const followable = environments
    .flatMap((environment, index) => {
      const connection = connections[environment.environmentId];
      const answer = methods[index]?.data;
      return connection?.status === "connected" && answer !== undefined && capabilitiesOf(answer).waitingJobs ? [`${environment.environmentId}@${connection.since}`] : [];
    })
    .join();
  const [byMachine, setByMachine] = useState<ReadonlyMap<string, QueueView>>(new Map());
  // Subscribing to server streams is synchronizing with something outside React.
  useEffect(() => {
    const stops = Object.entries(runtime.store.getState().connections).flatMap(([environmentId, connection]) =>
      connection.status === "connected" && hasQueue(environmentId, connection.since)
        ? [runtime.follow(environmentId, (client) => client["runners.subscribeQueue"](), (queue) => setByMachine((current) => new Map(current).set(environmentId, queue)))]
        : [],
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [followable]);
  // A machine removed from the saved list drops out, even though its last push is still held.
  return useMemo(
    () =>
      new Map(
        environments.flatMap((environment) => {
          const queue = byMachine.get(environment.environmentId);
          return queue ? [[environment.environmentId, queue] as const] : [];
        }),
      ),
    [environments, byMachine],
  );
}
