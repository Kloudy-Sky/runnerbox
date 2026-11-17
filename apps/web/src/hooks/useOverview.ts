import { useSearch } from "@tanstack/react-router";
import { useStore } from "zustand";
import { inboxRows } from "../lib/inboxRows.ts";
import { pullsEverywhere } from "../lib/pullsEverywhere.ts";
import { parseSearch } from "../lib/search.ts";
import { runtime } from "../runtime.ts";
import { useInboxEverywhere } from "./useInboxEverywhere.ts";
import { usePullRequestsEverywhere } from "./usePullRequestsEverywhere.ts";
import { useRange } from "./useRange.ts";
import { useRpcQueryEverywhere } from "./useRpcQueryEverywhere.ts";
import { useRunnerMachines } from "./useRunnerMachines.ts";
import { useRunnerQueueEverywhere } from "./useRunnerQueueEverywhere.ts";

// What Overview reads from every connected machine, through the hooks the Inbox, Runners and Pull
// requests use, narrowed to the machine in the URL's `machine` when there is one, as on Runners.
// Daily totals cover twice the range, so the range can be compared with the period before it. A
// machine that's offline keeps what it last answered.
export function useOverview() {
  const { days } = useRange();
  const { machine: key } = parseSearch(useSearch({ strict: false }));
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const inbox = useInboxEverywhere();
  const totals = useRpcQueryEverywhere(["dailyTotals", days * 2], (client) => client["history.dailyTotals"]({ days: days * 2 }), { refetchEvery: 60_000 });
  const pulls = usePullRequestsEverywhere();
  const runners = useRunnerMachines(days);
  const queues = useRunnerQueueEverywhere();
  const picked = runners.find((runner) => runner.key === key) ?? null;
  const shows = ({ environmentId }: { readonly environmentId: string }) => picked === null || picked.environmentId === environmentId;
  const machines = environments.filter(shows).map((environment) => {
    const answer = totals.find((each) => each.environment.environmentId === environment.environmentId);
    return {
      environmentId: environment.environmentId,
      label: environment.label,
      online: connections[environment.environmentId]?.status === "connected",
      days: answer?.data,
      // A server older than daily totals refuses them, which isn't the same as nothing having run.
      noTotals: answer?.data === undefined && answer?.isError === true,
      queue: queues.get(environment.environmentId),
    };
  });
  return {
    runners,
    picked,
    machines,
    shownRunners: picked ? [picked] : runners,
    pulls: pullsEverywhere(pulls.machines.filter(shows)).map(({ pull }) => pull),
    pullsLoaded: pulls.machines.length > 0,
    inbox: { machines: inbox.machines, rows: inboxRows(inbox.machines.filter(shows)) },
  };
}

export type OverviewMachine = ReturnType<typeof useOverview>["machines"][number];
