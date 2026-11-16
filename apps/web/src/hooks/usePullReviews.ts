import type { PullReviews } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { going } from "../lib/reviewWords.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// One pull request's reviews as the server keeps them, the newest first. Asked again every few
// seconds while the newest is still going, and not otherwise: a finished review never changes.
export function usePullReviews(repo: string, number: number) {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const enabled = useServerCapabilities().reviewRuns && Number.isInteger(number) && number > 0;
  const key = ["reviews", repo, number] as const;
  const reviewing = going(useQueryClient().getQueryData<PullReviews>([environmentId, ...key])?.reviews[0]);
  return useRpcQuery(key, (client) => client["reviews.read"]({ repo, number }), { enabled, ...(reviewing ? { refetchEvery: 3_000 } : {}) });
}
