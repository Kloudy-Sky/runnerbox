import type { ReviewsView } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { going } from "../lib/reviewWords.ts";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// The environment's reviews: the repositories the GitHub App is installed on, and
// their open pull requests, each with its newest review. Asked again every half minute, since pull
// requests change on GitHub's own time, and every few seconds while a review runs. `available` is
// false on a server older than reviews, and `canRun` on one that lists pull requests but can't
// review them.
export function useReviews() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const { reviews: available, reviewRuns: canRun } = useServerCapabilities();
  const queryClient = useQueryClient();
  const reviewing = queryClient.getQueryData<ReviewsView>([environmentId, "reviews"])?.pulls.some((pull) => going(pull.review)) ?? false;
  const status = useRpcQuery(["reviews"], (client) => client["reviews.status"](), { enabled: available, refetchEvery: reviewing ? 3_000 : 30_000 });
  // Every change answers with the view as it now is, so it's shown without asking again.
  const show = (view: ReviewsView) => void queryClient.setQueryData([environmentId, "reviews"], view);
  // A review starting or stopping changes the list and that pull request's page.
  const refresh = () => queryClient.invalidateQueries({ queryKey: [environmentId, "reviews"] });
  return {
    available,
    canRun,
    view: status.data ?? null,
    setRepo: (repo: string, review: boolean) => runtime.run(environmentId, (client) => client["reviews.setRepo"]({ repo, review })).then(show),
    setModel: (model: string) => runtime.run(environmentId, (client) => client["reviews.setModel"]({ model })).then(show),
    start: (repo: string, number: number) => runtime.run(environmentId, (client) => client["reviews.start"]({ repo, number })).then(refresh),
    stop: (repo: string, number: number) => runtime.run(environmentId, (client) => client["reviews.stop"]({ repo, number })).then(refresh),
  };
}
