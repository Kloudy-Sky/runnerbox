import { useAtomValue } from "@effect/atom-react";
import { inboxRows } from "../lib/inboxRows.ts";
import { loginsAtom } from "../state/github.ts";
import { reviewsEverywhereAtom } from "../state/reviews.ts";
import { useRange } from "./useRange.ts";
import { useRpcQueryEverywhere } from "./useRpcQueryEverywhere.ts";

// The Inbox across every connected machine: each machine's inbox, monitor, reviews, GitHub login
// and proposals, read where the single-machine hooks read them, and the rows built from them. A
// machine whose server lacks one of these answers without it.
export function useInboxEverywhere() {
  const { days } = useRange();
  const inboxes = useRpcQueryEverywhere(["inbox", days], (client) => client["inbox.list"]({ days }));
  const monitors = useRpcQueryEverywhere(["monitors"], (client) => client["monitors.status"](), { refetchEvery: 60_000 });
  const reviews = new Map(useAtomValue(reviewsEverywhereAtom).map(({ environment, view }) => [environment.environmentId, view]));
  const logins = useAtomValue(loginsAtom);
  // `up` applies an approved change on its own time.
  const proposals = useRpcQueryEverywhere(["proposals"], (client) => client["proposals.list"](), { refetchEvery: 15_000 });
  const machines = inboxes.map(({ environment, data }, index) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    inbox: data,
    monitors: monitors[index]?.data,
    reviews: reviews.get(environment.environmentId),
    login: logins.get(environment.environmentId),
    proposals: proposals[index]?.data,
  }));
  return { machines, rows: inboxRows(machines), loaded: inboxes.some((answer) => answer.data !== undefined) };
}

export type InboxMachine = ReturnType<typeof useInboxEverywhere>["machines"][number];
