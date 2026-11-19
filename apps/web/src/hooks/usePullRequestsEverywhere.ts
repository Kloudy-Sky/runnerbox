import { useAtomValue } from "@effect/atom-react";
import { pullsEverywhere } from "../lib/pullsEverywhere.ts";
import { appAtomRegistry } from "../rpc/atomRegistry.ts";
import { runtime } from "../runtime.ts";
import { pullReviewsAtom, reviewsAtom, reviewsEverywhereAtom } from "../state/reviews.ts";

// Every connected machine's reviews view, and their open pull requests as one list. Each machine's
// view is the one Settings reads, so the two never disagree.
export function usePullRequestsEverywhere() {
  const answers = useAtomValue(reviewsEverywhereAtom);
  const machines = answers.flatMap(({ environment, view }) => (view === undefined ? [] : [{ environmentId: environment.environmentId, label: environment.label, view }]));
  // A review starting or stopping changes that machine's list and the pull request's reviews.
  const refresh = (environmentId: string, repo: string, number: number) => {
    appAtomRegistry.refresh(reviewsAtom(environmentId));
    appAtomRegistry.refresh(pullReviewsAtom({ environmentId, repo, number }));
  };
  return {
    machines,
    pulls: pullsEverywhere(machines),
    // Some machine's server is older than reviews.
    refused: answers.some(({ older }) => older),
    start: (environmentId: string, repo: string, number: number) => runtime.run(environmentId, (client) => client["reviews.start"]({ repo, number })).then(() => refresh(environmentId, repo, number)),
    stop: (environmentId: string, repo: string, number: number) => runtime.run(environmentId, (client) => client["reviews.stop"]({ repo, number })).then(() => refresh(environmentId, repo, number)),
  };
}
