import type { ReviewsView } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// The environment's reviews: the GitHub App connected, the repositories it's installed on, and
// their open pull requests. Asked again every half minute, since pull requests change on GitHub's
// own time. `available` is false on a server older than reviews.
export function useReviews() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const available = useServerCapabilities().reviews;
  const queryClient = useQueryClient();
  const status = useRpcQuery(["reviews"], (client) => client["reviews.status"](), { enabled: available, refetchEvery: 30_000 });
  // Every change answers with the view as it now is, so it's shown without asking again.
  const show = (view: ReviewsView) => void queryClient.setQueryData([environmentId, "reviews"], view);
  return {
    available,
    view: status.data ?? null,
    connect: (appId: string, privateKey: string) => runtime.run(environmentId, (client) => client["reviews.connect"]({ appId, privateKey })).then(show),
    disconnect: () => runtime.run(environmentId, (client) => client["reviews.disconnect"]()).then(show),
    setRepo: (repo: string, review: boolean) => runtime.run(environmentId, (client) => client["reviews.setRepo"]({ repo, review })).then(show),
  };
}
