import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { pullReviewsAtom } from "../state/reviews.ts";

// One pull request's reviews as the machine that ran them keeps them, the newest first, and why
// the last ask failed, if it did.
export function usePullReviews(environmentId: string, repo: string, number: number) {
  const kept = useAtomValue(pullReviewsAtom({ environmentId, repo, number }));
  return { data: Option.getOrUndefined(AsyncResult.value(kept)), error: AsyncResult.isFailure(kept) ? Cause.squash(kept.cause) : null };
}
