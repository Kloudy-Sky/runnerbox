import type { ReviewsView } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { pullsEverywhere } from "../lib/pullsEverywhere.ts";
import { going } from "../lib/reviewWords.ts";
import { runtime } from "../runtime.ts";
import { useRpcQueryEverywhere } from "./useRpcQueryEverywhere.ts";

// Every connected machine's reviews view, and their open pull requests as one list. Asked again
// every half minute, since pull requests change on GitHub's own time, and every few seconds while
// any machine's review runs. It caches where `useReviews` does, so Settings and this page share
// the active machine's answer. A server older than reviews answers with an error and adds nothing.
export function usePullRequestsEverywhere() {
  const queryClient = useQueryClient();
  const reviewing = queryClient
    .getQueriesData<ReviewsView>({ predicate: (query) => query.queryKey[1] === "reviews" && query.queryKey.length === 2 })
    .some(([, view]) => view?.pulls.some((pull) => going(pull.review)) ?? false);
  const answers = useRpcQueryEverywhere(["reviews"], (client) => client["reviews.status"](), { refetchEvery: reviewing ? 3_000 : 30_000 });
  const machines = answers.flatMap(({ environment, data }) => (data === undefined ? [] : [{ environmentId: environment.environmentId, label: environment.label, view: data }]));
  // A review starting or stopping changes that machine's list and the pull request's reviews.
  const refresh = (environmentId: string) => queryClient.invalidateQueries({ queryKey: [environmentId, "reviews"] });
  return {
    machines,
    pulls: pullsEverywhere(machines),
    // Some machine refused, as a server older than reviews does.
    refused: answers.some(({ isError }) => isError),
    start: (environmentId: string, repo: string, number: number) => runtime.run(environmentId, (client) => client["reviews.start"]({ repo, number })).then(() => refresh(environmentId)),
    stop: (environmentId: string, repo: string, number: number) => runtime.run(environmentId, (client) => client["reviews.stop"]({ repo, number })).then(() => refresh(environmentId)),
  };
}
