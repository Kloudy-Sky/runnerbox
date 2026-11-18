import { opensInBrowser } from "@runnerbox/client-runtime";
import type { CiRepo, CiRunner, CiVariable, RunnerVariable } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { MoveCiSteps } from "./MoveCiSteps.tsx";
import { RunOn, type RunOnChoice } from "./RunOn.tsx";

const jobs = (count: number) => (count === 1 ? "1 job" : `${count} jobs`);
const words = (cause: unknown) => (cause instanceof Error ? cause.message : "That didn't work.");
const KIND: Record<RunnerVariable, string> = { LINUX_RUNNER: "Linux", MAC_RUNNER: "Mac" };

// Where a variable sends its jobs, in a few words.
function where({ value, org }: CiVariable, runners: ReadonlyArray<CiRunner>) {
  if (value !== null) return runners.some((runner) => runner.label === value) ? `here on ${value}` : `on ${value}, which isn't a runner here`;
  return org !== null ? `on ${org}, which the organization sets` : "on GitHub";
}

// One line on where a repository's jobs run, and how many can't move yet.
function summary(repo: CiRepo, runners: ReadonlyArray<CiRunner>) {
  const patched = repo.jobs.filter((job) => job.state === "patched").length;
  const moves = repo.jobs.filter((job) => job.state === "moves").length;
  const notYet = patched > 0 ? `${patched} of ${jobs(repo.jobs.length)} can't move yet.` : null;
  if (repo.switch === "ready") {
    const runs = repo.variables.length === 1 ? `Runs ${where(repo.variables[0]!, runners)}.` : repo.variables.map((each) => `${KIND[each.name]} jobs run ${where(each, runners)}.`).join(" ");
    return [runs, notYet].filter(Boolean).join(" ");
  }
  if (notYet) return notYet;
  if (moves === 0) return repo.jobs.length > 0 ? "No job names a runner that can move." : "";
  return moves === repo.jobs.length ? `${moves === 1 ? "Its 1 job" : `All ${moves} jobs`} can move.` : `${moves} of ${jobs(repo.jobs.length)} can move.`;
}

// The runners on this machine a variable can name, and why a job reading it couldn't use each one.
function choicesFor(repo: CiRepo, name: RunnerVariable, runners: ReadonlyArray<CiRunner>): ReadonlyArray<RunOnChoice> {
  const reading = repo.jobs.filter((job) => job.state === "moves" && job.variable === name);
  const docker = reading.find((job) => job.docker !== null);
  return runners.filter((runner) => runner.mac === (name === "MAC_RUNNER")).map((runner) => ({ label: runner.label, unfit: docker && !runner.docker ? `${docker.job} needs Docker` : null }));
}

type Moved = { readonly variable: RunnerVariable; readonly from: string | null; readonly to: string | null };

// A repository: where its jobs run, with a switch for each runner variable they read, opening to
// the patch for the jobs that don't read one yet. After a move it says where new runs go, with Undo.
export function CiRepoRow({ repo, runners, canSwitch, setRunner }: { repo: CiRepo; runners: ReadonlyArray<CiRunner>; canSwitch: boolean; setRunner: ((repo: string, variable: RunnerVariable, label: string | null) => Promise<void>) | null }) {
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = (variable: RunnerVariable, from: string | null, to: string | null) => {
    if (setRunner === null) return;
    setMoving(true);
    setError(null);
    setRunner(repo.repo, variable, to)
      .then(
        () => setMoved({ variable, from, to }),
        (cause: unknown) => setError(words(cause)),
      )
      .finally(() => setMoving(false));
  };
  const opens = repo.patch !== null || repo.jobs.some((job) => job.docker !== null || job.state === "left");
  const line = summary(repo, runners);
  const owner = repo.repo.split("/")[0];
  const head = (
    <>
      <span className="truncate font-medium">{repo.repo}</span>
      <span className="text-muted-foreground">
        {line}
        {repo.problem ? ` ${repo.problem}` : ""}
      </span>
    </>
  );
  const columns = "grid grid-cols-[1rem_minmax(0,14rem)_minmax(0,1fr)] items-start gap-x-2 text-left";
  return (
    <Collapsible>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
        {opens ? (
          <CollapsibleTrigger className={`group/repo w-full ${columns}`}>
            <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground transition-transform duration-150 group-data-panel-open/repo:rotate-90" />
            {head}
          </CollapsibleTrigger>
        ) : (
          <div className={columns}>
            <span />
            {head}
          </div>
        )}
        {repo.switch === "ready" && setRunner !== null ? (
          <div className="flex flex-col items-end gap-1">
            {repo.variables.map((variable) => (
              <div key={variable.name} className="flex items-center gap-2">
                {repo.variables.length > 1 ? <span className="text-muted-foreground text-xs">{KIND[variable.name]}</span> : null}
                <RunOn variable={variable} choices={choicesFor(repo, variable.name, runners)} disabled={!canSwitch || moving} onChoose={(label) => choose(variable.name, variable.value, label)} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="pl-[calc(1rem+0.5rem)] text-xs">
        {moving ? <p className="text-muted-foreground">Moving</p> : null}
        {moved !== null && !moving ? (
          <p className="text-muted-foreground">
            <span className="text-foreground">Moved to {moved.to ?? "GitHub"}.</span> New runs start there; jobs already waiting stay put.{" "}
            <button type="button" className="text-foreground underline-offset-2 hover:underline" onClick={() => choose(moved.variable, moved.to, moved.from)}>
              Undo
            </button>
          </p>
        ) : null}
        {error !== null ? <p className="text-destructive">{error}</p> : null}
        {repo.switch === "approve" ? (
          <p className="text-warning">
            {owner} hasn't accepted the Variables permission, so this can't be switched from here.{" "}
            {repo.approveUrl !== null && opensInBrowser(repo.approveUrl) ? (
              <a href={repo.approveUrl} target="_blank" rel="noreferrer noopener" className="text-foreground underline-offset-2 hover:underline">
                Accept on GitHub
              </a>
            ) : null}
          </p>
        ) : null}
        {repo.switch === "refused" ? <p className="text-muted-foreground">GitHub won't show this repository's variables to you. Switching needs write access to it.</p> : null}
        {repo.switch === "ready" && !canSwitch ? <p className="text-muted-foreground">This device can't move CI.</p> : null}
      </div>
      {opens ? (
        <CollapsiblePanel>
          <MoveCiSteps repo={repo} />
        </CollapsiblePanel>
      ) : null}
    </Collapsible>
  );
}
