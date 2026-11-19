import type { MoveCiView, RepoRuns, RunnerVariable } from "@runnerbox/contracts";
import { CiRepoRow } from "./CiRepoRow.tsx";
import { SectionTitle } from "./SectionTitle.tsx";

const range = (days: number) => (days === 1 ? "jobs in the last day" : `jobs in the last ${days} days`);

// Each repository the server's sign-in reaches, one line each: where its jobs ran over the page's
// range, and a switch between this machine's runners and GitHub. A row that isn't set up opens to
// the steps that set it up. `runs` is null on a server too old to count where jobs ran, "unknown"
// until it has answered, and
// `setRunner` null on one older than the switch.
export function MoveCi({ view, runs, days, setRunner }: { view: MoveCiView; runs: ReadonlyMap<string, RepoRuns> | "unknown" | null; days: number; setRunner: ((repo: string, variable: RunnerVariable, label: string | null) => Promise<void>) | null }) {
  return (
    <section>
      <SectionTitle note={runs !== null ? range(days) : undefined} noteClassName="max-sm:hidden">Where CI runs</SectionTitle>
      <div className={runs !== null ? "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 divide-y divide-border sm:grid-cols-[minmax(0,1fr)_9.5rem_auto]" : "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3.5 divide-y divide-border"}>
        {view.repos.map((repo) => (
          <CiRepoRow key={repo.repo} repo={repo} runners={view.runners} runs={runs === null || runs === "unknown" ? runs : (runs.get(repo.repo) ?? { repo: repo.repo, here: 0, github: 0 })} canSwitch={view.canSwitch} setRunner={setRunner} />
        ))}
      </div>
      {view.problem ? <p className="pt-2 text-muted-foreground">{view.problem}</p> : null}
    </section>
  );
}
