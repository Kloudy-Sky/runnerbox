import type { JobRun } from "@runnerbox/contracts";
import { useQuery } from "@tanstack/react-query";
import * as Effect from "effect/Effect";
import { jobName } from "../lib/format.ts";
import type { ReferenceCandidate } from "../lib/composerReferences.ts";
import { runtime } from "../runtime.ts";

const RUNS_PER_REPO = 50;

// A run's name in the list, its chip and the sent question. When a run was retried, each attempt
// says which it is, the first included, so the two can be told apart.
const attemptKey = (run: JobRun) => `${run.repo}#${run.runId}#${run.job}`;
const runLabel = (run: JobRun, retried: ReadonlySet<string>) => `${jobName(run)} #${run.runId}${retried.has(attemptKey(run)) || run.attempt > 1 ? `, attempt ${run.attempt}` : ""}`;

// What `@` can refer to on this server: its other threads, newest first, then recent runs in each
// repo. Asked for only while the menu is open.
export function useReferenceCandidates(environmentId: string, days: number, currentThreadId: string | null, open: boolean) {
  const candidates = useQuery({
    queryKey: [environmentId, "referenceCandidates", days],
    queryFn: () =>
      runtime.run(environmentId, (client) =>
        Effect.gen(function* () {
          const threads = yield* client["threads.list"]({});
          const repos = yield* client["history.repos"]();
          const runs = yield* Effect.forEach(repos, (repo) => client["history.runs"]({ repo, days, limit: RUNS_PER_REPO }), { concurrency: "unbounded" });
          const fromThreads = threads.map((thread): ReferenceCandidate => ({ kind: "thread", id: thread.id, label: thread.title, detail: "thread" }));
          const allRuns = runs.flat();
          const retried = new Set(allRuns.filter((run) => run.attempt > 1).map(attemptKey));
          const fromRuns = allRuns.map((run): ReferenceCandidate => ({ kind: "run", repo: run.repo, jobId: run.jobId, days, label: runLabel(run, retried), detail: `run, ${run.conclusion ?? "running"}` }));
          return [...fromThreads, ...fromRuns];
        }),
      ),
    enabled: open,
    staleTime: 30_000,
  });
  const items = (candidates.data ?? []).filter((candidate) => !(candidate.kind === "thread" && candidate.id === currentThreadId));
  return { items, loading: candidates.isPending, failed: candidates.isError };
}
