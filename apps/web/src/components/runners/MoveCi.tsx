import type { CiRepo, MoveCiView } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { MoveCiSteps } from "./MoveCiSteps.tsx";
import { SectionTitle } from "./SectionTitle.tsx";

const jobs = (count: number) => (count === 1 ? "1 job" : `${count} jobs`);

// One line on whether a repository's jobs move when its runner variable changes.
function summary(repo: CiRepo) {
  const patched = repo.jobs.filter((job) => job.state === "patched").length;
  const moves = repo.jobs.filter((job) => job.state === "moves").length;
  if (patched > 0) return `${patched} of ${jobs(repo.jobs.length)} can't move yet.`;
  if (moves === 0) return repo.jobs.length > 0 ? "No job names a runner that can move." : null;
  return moves === repo.jobs.length ? `${moves === 1 ? "Its 1 job" : `All ${moves} jobs`} can move.` : `${moves} of ${jobs(repo.jobs.length)} can move.`;
}

// Each repository the server's sign-in reaches, and whether its jobs read a runner variable, so
// changing it moves them on or off Runnerbox. A row opens to the patch for the jobs that don't yet,
// and to the ones that need Docker or are left alone.
export function MoveCi({ view }: { view: MoveCiView }) {
  const ready = view.repos.filter((repo) => repo.jobs.some((job) => job.state === "moves") && !repo.jobs.some((job) => job.state === "patched")).length;
  return (
    <section>
      <SectionTitle note={`${ready} of ${view.repos.length} ${view.repos.length === 1 ? "repository" : "repositories"} ready`}>Move CI</SectionTitle>
      <div className="flex flex-col gap-1.5">
        {view.repos.map((repo) => {
          const line = summary(repo);
          const opens = repo.patch !== null || repo.jobs.some((job) => job.docker !== null || job.state === "left");
          const row = (
            <>
              <span className="truncate font-medium">{repo.repo}</span>
              <span className="text-muted-foreground">
                {line}
                {repo.problem ? ` ${repo.problem}` : ""}
              </span>
            </>
          );
          if (!opens) return <div key={repo.repo} className="grid grid-cols-[1rem_minmax(0,14rem)_minmax(0,1fr)] gap-x-2"><span />{row}</div>;
          return (
            <Collapsible key={repo.repo}>
              <CollapsibleTrigger className="group/repo grid w-full grid-cols-[1rem_minmax(0,14rem)_minmax(0,1fr)] items-start gap-x-2 text-left">
                <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground transition-transform duration-150 group-data-panel-open/repo:rotate-90" />
                {row}
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <MoveCiSteps repo={repo} />
              </CollapsiblePanel>
            </Collapsible>
          );
        })}
      </div>
      {view.problem ? <p className="pt-2 text-muted-foreground">{view.problem}</p> : null}
    </section>
  );
}
