import type { RunnerboxClient } from "@runnerbox/client-runtime";
import { useQueries } from "@tanstack/react-query";
import type * as Effect from "effect/Effect";
import { useStore } from "zustand";
import { runtime } from "../runtime.ts";

type Options = {
  // Ask again on this interval, in ms, for state that changes on the server's own time.
  readonly refetchEvery?: number;
  readonly enabled?: boolean;
};

// One RPC call on every saved machine, each answer kept with the machine it came from. It caches
// under the same key `useRpcQuery` uses, so the active machine's answer is shared between them. A
// machine that isn't connected keeps what it last returned and never holds up the others.
export function useRpcQueryEverywhere<A, E>(key: readonly unknown[], call: (client: RunnerboxClient) => Effect.Effect<A, E>, { refetchEvery, enabled = true }: Options = {}) {
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const answers = useQueries({
    queries: environments.map((environment) => ({
      queryKey: [environment.environmentId, ...key],
      queryFn: () => runtime.run(environment.environmentId, call),
      enabled: enabled && connections[environment.environmentId]?.status === "connected",
      refetchInterval: refetchEvery ?? false,
    })),
  });
  return environments.map((environment, index) => ({ environment, data: answers[index]?.data, isError: answers[index]?.isError ?? false }));
}
