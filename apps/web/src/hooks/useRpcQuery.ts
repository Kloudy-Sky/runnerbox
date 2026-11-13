import type { RunnerboxClient } from "@runnerbox/client-runtime";
import { useQuery } from "@tanstack/react-query";
import type * as Effect from "effect/Effect";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// One RPC call on the active environment, cached per environment under `key`. It runs only while
// connected; what it last returned stays shown while the connection is down. `refetchEvery` asks
// again on that interval, in ms, for state that changes on the server's own time.
export function useRpcQuery<A, E>(key: readonly unknown[], call: (client: RunnerboxClient) => Effect.Effect<A, E>, refetchEvery?: number) {
  const { environment, connection } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  return useQuery({
    queryKey: [environmentId, ...key],
    queryFn: () => runtime.run(environmentId, call),
    enabled: connection?.status === "connected",
    refetchInterval: refetchEvery ?? false,
  });
}
