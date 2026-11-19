import { useSearch } from "@tanstack/react-router";
import { useStore } from "zustand";
import { answersForRepo } from "../lib/answersForRepo.ts";
import { inboxRows, type MachineAnswers } from "../lib/inboxRows.ts";
import { pullsEverywhere } from "../lib/pullsEverywhere.ts";
import { parseSearch } from "../lib/search.ts";
import { runtime } from "../runtime.ts";
import { useInboxEverywhere } from "./useInboxEverywhere.ts";
import { usePullRequestsEverywhere } from "./usePullRequestsEverywhere.ts";
import { useRange } from "./useRange.ts";
import { useRpcQueryEverywhere } from "./useRpcQueryEverywhere.ts";
import { useAtomValue } from "@effect/atom-react";
import { runnerQueueEverywhereAtom } from "../state/runnerMachines.ts";
import { useRunnerMachines } from "./useRunnerMachines.ts";

// What Overview reads from every connected machine, through the hooks the Inbox, Runners and Pull
// requests use, narrowed to the machine in the URL's `machine` when there is one, as on Runners,
// and to its `repo`. Runners don't say which repository their job is from, so they stay whole.
// Daily totals cover twice the range, so the range can be compared with the period before it. A
// machine that's offline keeps what it last answered.
export function useOverview() {
  const { days } = useRange();
  const { machine: key, repo } = parseSearch(useSearch({ strict: false }));
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const inbox = useInboxEverywhere();
  const totals = useRpcQueryEverywhere(["dailyTotals", days * 2, repo ?? null], (client) => client["history.dailyTotals"]({ days: days * 2, ...(repo ? { repo } : {}) }), { refetchEvery: 60_000 });
  const repoLists = useRpcQueryEverywhere(["repos"], (client) => client["history.repos"]());
  const pulls = usePullRequestsEverywhere();
  const runners = useRunnerMachines(days);
  const queues = useAtomValue(runnerQueueEverywhereAtom);
  const picked = runners.find((runner) => runner.key === key) ?? null;
  const shows = ({ environmentId }: { readonly environmentId: string }) => picked === null || picked.environmentId === environmentId;
  const narrow = <Answers extends MachineAnswers>(answers: Answers) => (repo ? answersForRepo(answers, repo) : answers);
  // Repositories with jobs on any machine, and those with reviews on, whose jobs may all run on GitHub's runners.
  const repos = new Set([...repoLists.flatMap((answer) => answer.data ?? []), ...pulls.machines.flatMap(({ view }) => view.repos.flatMap((each) => (each.review ? [each.repo] : [])))]);
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
    repo: repo ?? null,
    repos: [...repos].toSorted(),
    pulls: pullsEverywhere(pulls.machines.filter(shows)).flatMap(({ pull }) => (repo === undefined || pull.repo === repo ? [pull] : [])),
    pullsLoaded: pulls.machines.length > 0,
    inbox: { machines: inbox.machines, rows: inboxRows(inbox.machines.filter(shows).map(narrow)) },
  };
}

export type OverviewMachine = ReturnType<typeof useOverview>["machines"][number];
