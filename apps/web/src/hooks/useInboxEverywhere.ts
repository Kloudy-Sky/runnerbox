import { inboxRows } from "../lib/inboxRows.ts";
import { useRange } from "./useRange.ts";
import { useRpcQueryEverywhere } from "./useRpcQueryEverywhere.ts";

// The Inbox across every connected machine: each machine's inbox, monitor, reviews, GitHub login
// and proposals, under the same keys the single-machine hooks use, and the rows built from them. A
// machine whose server lacks one of these answers without it.
export function useInboxEverywhere() {
  const { days } = useRange();
  const inboxes = useRpcQueryEverywhere(["inbox", days], (client) => client["inbox.list"]({ days }));
  const monitors = useRpcQueryEverywhere(["monitors"], (client) => client["monitors.status"](), { refetchEvery: 60_000 });
  const reviews = useRpcQueryEverywhere(["reviews"], (client) => client["reviews.status"](), { refetchEvery: 30_000 });
  const github = useRpcQueryEverywhere(["github"], (client) => client["github.status"](), { refetchEvery: 30_000 });
  // `up` applies an approved change on its own time.
  const proposals = useRpcQueryEverywhere(["proposals"], (client) => client["proposals.list"](), { refetchEvery: 15_000 });
  const machines = inboxes.map(({ environment, data }, index) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    inbox: data,
    monitors: monitors[index]?.data,
    reviews: reviews[index]?.data,
    login: github[index]?.data?.account,
    proposals: proposals[index]?.data,
  }));
  return { machines, rows: inboxRows(machines), loaded: inboxes.some((answer) => answer.data !== undefined) };
}

export type InboxMachine = ReturnType<typeof useInboxEverywhere>["machines"][number];
