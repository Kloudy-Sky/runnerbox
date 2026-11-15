import type { RunnerboxClient } from "@runnerbox/client-runtime";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type * as Effect from "effect/Effect";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

type Options = {
  // Ask again on this interval, in ms, for state that changes on the server's own time.
  readonly refetchEvery?: number;
  readonly enabled?: boolean;
  // While a new key loads, keep showing what the last key returned, so a page that changes its
  // range or grouping updates in place instead of going blank.
  readonly keepPrevious?: boolean;
};

// One RPC call on the active environment, cached per environment under `key`. It runs only while
// connected, and `enabled`; what it last returned stays shown while the connection is down.
export function useRpcQuery<A, E>(key: readonly unknown[], call: (client: RunnerboxClient) => Effect.Effect<A, E>, { refetchEvery, enabled = true, keepPrevious }: Options = {}) {
  const { environment, connection } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  return useQuery({
    queryKey: [environmentId, ...key],
    queryFn: () => runtime.run(environmentId, call),
    enabled: enabled && connection?.status === "connected",
    refetchInterval: refetchEvery ?? false,
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });
}
