import type { PullReviews } from "@runnerbox/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { going } from "../lib/reviewWords.ts";
import { runtime } from "../runtime.ts";

// One pull request's reviews as the machine that ran them keeps them, the newest first. Asked again
// every few seconds while the newest is still going, and not otherwise: a finished review never
// changes. Cached where `useRpcQuery` would cache it for that machine.
export function usePullReviews(environmentId: string, repo: string, number: number) {
  const connected = useStore(runtime.store, (state) => state.connections[environmentId]?.status === "connected");
  const queryKey = [environmentId, "reviews", repo, number] as const;
  const reviewing = going(useQueryClient().getQueryData<PullReviews>(queryKey)?.reviews[0]);
  return useQuery({
    queryKey,
    queryFn: () => runtime.run(environmentId, (client) => client["reviews.read"]({ repo, number })),
    enabled: connected && Number.isInteger(number) && number > 0,
    refetchInterval: reviewing ? 3_000 : false,
  });
}
