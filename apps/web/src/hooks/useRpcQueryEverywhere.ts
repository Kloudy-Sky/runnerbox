import type { RunnerboxClient } from "@runnerbox/client-runtime";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import type * as Effect from "effect/Effect";
import { useStore } from "zustand";
import { runtime } from "../runtime.ts";

type Options = {
  // Ask again on this interval, in ms, for state that changes on the server's own time.
  readonly refetchEvery?: number;
  readonly enabled?: boolean;
  // While a new key loads, each machine keeps showing what it last returned, as `useRpcQuery` does.
  readonly keepPrevious?: boolean;
};

// One RPC call on every saved machine, each answer kept with the machine it came from. It caches
// under the same key `useRpcQuery` uses, so the active machine's answer is shared between them. A
// machine that isn't connected keeps what it last returned and never holds up the others.
export function useRpcQueryEverywhere<A, E>(key: readonly unknown[], call: (client: RunnerboxClient) => Effect.Effect<A, E>, { refetchEvery, enabled = true, keepPrevious }: Options = {}) {
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const answers = useQueries({
    queries: environments.map((environment) => ({
      queryKey: [environment.environmentId, ...key],
      queryFn: () => runtime.run(environment.environmentId, call),
      enabled: enabled && connections[environment.environmentId]?.status === "connected",
      refetchInterval: refetchEvery ?? false,
      ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
    })),
  });
  return environments.map((environment, index) => ({ environment, data: answers[index]?.data, isError: answers[index]?.isError ?? false }));
}
