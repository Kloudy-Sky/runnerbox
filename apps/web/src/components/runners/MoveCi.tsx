import type { MoveCiView, RunnerVariable } from "@runnerbox/contracts";
import { CiRepoRow } from "./CiRepoRow.tsx";
import { SectionTitle } from "./SectionTitle.tsx";

// Each repository the server's sign-in reaches, and where its jobs run: here or on GitHub, with a
// switch that sets its runner variable. A row opens to the patch for the jobs that don't read the
// variable yet, and to the ones that need Docker or are left alone. `setRunner` is null on a
// server older than the switch.
export function MoveCi({ view, setRunner }: { view: MoveCiView; setRunner: ((repo: string, variable: RunnerVariable, label: string | null) => Promise<void>) | null }) {
  const labels = new Set(view.runners.map((runner) => runner.label));
  const here = view.repos.filter((repo) => repo.variables.some((variable) => variable.value !== null && labels.has(variable.value))).length;
  return (
    <section>
      <SectionTitle note={`${here} of ${view.repos.length} ${view.repos.length === 1 ? "repository" : "repositories"} running here`}>Where CI runs</SectionTitle>
      <div className="flex flex-col gap-2">
        {view.repos.map((repo) => (
          <CiRepoRow key={repo.repo} repo={repo} runners={view.runners} canSwitch={view.canSwitch} setRunner={setRunner} />
        ))}
      </div>
      {view.problem ? <p className="pt-2 text-muted-foreground">{view.problem}</p> : null}
    </section>
  );
}
