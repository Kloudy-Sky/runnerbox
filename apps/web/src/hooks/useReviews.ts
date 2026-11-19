import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { capabilitiesOf, NO_CAPABILITIES } from "../lib/serverCapabilities.ts";
import { runtime } from "../runtime.ts";
import { serverMethodsAtom } from "../state/connections.ts";
import { reviewsAtom } from "../state/reviews.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// The active environment's reviews: the repositories the GitHub App is installed on, their open
// pull requests, each with its newest review, and the settings that pick what's reviewed.
// `available` is false on a server older than reviews.
export function useReviews() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const status = useAtomValue(reviewsAtom(environmentId));
  const methods = useAtomValue(serverMethodsAtom(environmentId));
  // Every change answers with the view as it now is, so it's shown without asking again.
  const show = useAtomSet(reviewsAtom(environmentId));
  return {
    available: Option.match(AsyncResult.value(methods), { onNone: () => NO_CAPABILITIES, onSome: capabilitiesOf }).reviews,
    view: Option.getOrNull(AsyncResult.value(status)),
    setRepo: (repo: string, review: boolean) => runtime.run(environmentId, (client) => client["reviews.setRepo"]({ repo, review })).then(show),
    setModel: (model: string) => runtime.run(environmentId, (client) => client["reviews.setModel"]({ model })).then(show),
  };
}
