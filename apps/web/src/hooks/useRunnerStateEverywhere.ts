import type { InstallState } from "@runnerbox/contracts";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { runtime } from "../runtime.ts";

// Every saved machine's live slot state, pushed by its server whenever it changes, keyed by the
// machine's environment id. A machine appears with its first push, and one that disconnects keeps
// its last state until it reconnects.
export function useRunnerStateEverywhere() {
  const environments = useStore(runtime.store, (state) => state.environments);
  // Which machines are connected, and since when, as one value: following restarts only when that
  // changes, not when an unrelated machine starts reconnecting.
  const connected = useStore(runtime.store, (state) =>
    Object.entries(state.connections)
      .flatMap(([environmentId, connection]) => (connection.status === "connected" ? [`${environmentId}@${connection.since}`] : []))
      .join(),
  );
  const [byMachine, setByMachine] = useState<ReadonlyMap<string, ReadonlyArray<InstallState>>>(new Map());
  // Subscribing to server streams is synchronizing with something outside React.
  useEffect(() => {
    const stops = Object.entries(runtime.store.getState().connections).flatMap(([environmentId, connection]) =>
      connection.status === "connected"
        ? [runtime.follow(environmentId, (client) => client["runners.subscribeState"](), (installs) => setByMachine((current) => new Map(current).set(environmentId, installs)))]
        : [],
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [connected]);
  // A machine removed from the saved list drops out, even though its last push is still held.
  return useMemo(
    () =>
      new Map(
        environments.flatMap((environment) => {
          const installs = byMachine.get(environment.environmentId);
          return installs ? [[environment.environmentId, installs] as const] : [];
        }),
      ),
    [environments, byMachine],
  );
}
