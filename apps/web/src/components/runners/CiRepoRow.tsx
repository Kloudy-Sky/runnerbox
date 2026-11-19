import { opensInBrowser } from "@runnerbox/client-runtime";
import type { CiRepo, CiRunner, CiVariable, RepoRuns, RunnerVariable } from "@runnerbox/contracts";
import { type ReactNode, useState } from "react";
import { patchLanded } from "../../lib/patchLanded.ts";
import { MoveCiSteps } from "./MoveCiSteps.tsx";
import { RunOn, type RunOnChoice } from "./RunOn.tsx";
import { RunsBar } from "./RunsBar.tsx";

const jobs = (count: number) => (count === 1 ? "1 job" : `${count} jobs`);
const words = (cause: unknown) => (cause instanceof Error ? cause.message : "That didn't work.");
const KIND: Record<RunnerVariable, string> = { LINUX_RUNNER: "Linux", MAC_RUNNER: "Mac" };
const link = "text-foreground underline-offset-2 hover:underline";

// Where a variable sends its jobs when the switch alone can't say: a label that isn't a runner here,
// or the organization's value.
function elsewhere({ name, value, org }: CiVariable, runners: ReadonlyArray<CiRunner>, several: boolean) {
  const whose = several ? `${KIND[name]} jobs run` : "Runs";
  if (value !== null) return runners.some((runner) => runner.label === value) ? null : `${whose} on ${value}, which isn't a runner here.`;
  return org !== null ? `${whose} on ${org}, which the organization sets.` : null;
}

// How many of a repository's jobs can't move yet, in a few words, or null when they all can.
function notYet(repo: CiRepo) {
  const patched = repo.jobs.filter((job) => job.state === "patched").length;
  const moves = repo.jobs.filter((job) => job.state === "moves").length;
  if (patched > 0) return moves === 0 ? "No job can move yet." : `${patched} of ${jobs(repo.jobs.length)} don't move yet.`;
  return moves === 0 && repo.jobs.length > 0 ? "No job names a runner that can move." : null;
}

// The runners on this machine a variable can name, and why a job reading it couldn't use each one.
function choicesFor(repo: CiRepo, name: RunnerVariable, runners: ReadonlyArray<CiRunner>): ReadonlyArray<RunOnChoice> {
  const reading = repo.jobs.filter((job) => job.state === "moves" && job.variable === name);
  const docker = reading.find((job) => job.docker !== null);
  return runners.filter((runner) => runner.mac === (name === "MAC_RUNNER")).map((runner) => ({ label: runner.label, unfit: docker && !runner.docker ? `${docker.job} needs Docker` : null }));
}

type Moved = { readonly variable: RunnerVariable; readonly from: string | null; readonly to: string | null };

// A repository on one line: its name, where its jobs ran over the page's range (`runs` is null on a
// server too old to say, and "unknown" before it has), and a switch for each runner variable they
// read. The line under it says what's in the way, if anything, and opens the setup steps in the
// row, where the switch moves to. After a move it says where new runs go, with Undo.
export function CiRepoRow({ repo, runners, runs, canSwitch, setRunner }: { repo: CiRepo; runners: ReadonlyArray<CiRunner>; runs: RepoRuns | "unknown" | null; canSwitch: boolean; setRunner: ((repo: string, variable: RunnerVariable, label: string | null) => Promise<void>) | null }) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Once a patch this row showed is gone, it's on the default branch, and the steps tick.
  const [sawPatch, setSawPatch] = useState(false);
  if (repo.patch !== null && !sawPatch) setSawPatch(true);
  const landed = sawPatch && patchLanded(repo);
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
  // Undo writes back what was there, which the server takes only when it's a runner here that fits,
  // or a delete the organization's value wouldn't override.
  const undoable =
    moved !== null &&
    (moved.from === null
      ? !repo.variables.some((each) => each.name === moved.variable && each.org !== null)
      : choicesFor(repo, moved.variable, runners).some((choice) => choice.label === moved.from && choice.unfit === null));
  const ready = repo.switch === "ready" && repo.variables.length > 0;
  const several = repo.variables.length > 1;
  const switches = (align: "start" | "end") => ready ? (
    <div className={align === "end" ? "flex flex-col items-end gap-1" : "flex flex-col items-start gap-1"}>
      {repo.variables.map((variable) => (
        <div key={variable.name} className="flex items-center gap-2">
          {several ? <span className="text-muted-foreground text-xs">{KIND[variable.name]}</span> : null}
          <RunOn variable={variable} choices={choicesFor(repo, variable.name, runners)} disabled={setRunner === null || !canSwitch || moving} align={align} onChoose={(label) => choose(variable.name, variable.value, label)} />
        </div>
      ))}
    </div>
  ) : (
    <RunOn variable={null} choices={[]} disabled align={align} onChoose={() => undefined} />
  );
  const owner = repo.repo.split("/")[0];
  const allow =
    repo.switch === "approve" && repo.approveUrl !== null && opensInBrowser(repo.approveUrl) ? (
      <a href={repo.approveUrl} target="_blank" rel="noreferrer noopener" className={link}>
        Allow on GitHub
      </a>
    ) : null;
  const opens = repo.patch !== null || repo.jobs.some((job) => job.docker !== null || job.state === "left");
  // While the steps are shown, the third holds the switch, so the row shows Hide in its place.
  const stepsShown = open && (repo.patch !== null || landed);
  const toggle = repo.patch !== null ? (repo.jobs.some((job) => job.state === "moves") ? "Set them up" : "Set it up") : "Details";
  const said: ReactNode[] = [];
  const say = (key: string, node: ReactNode) => said.push(<span key={key}>{node} </span>);
  const blocked = notYet(repo);
  if (blocked) say("not-yet", blocked);
  for (const variable of repo.variables) {
    const sentence = elsewhere(variable, runners, several);
    if (sentence) say(variable.name, sentence);
  }
  // Open, the third step says it instead.
  if (repo.switch === "approve" && !open)
    say(
      "approve",
      <span className="text-warning">
        {owner} hasn't allowed Runnerbox to set variables. {allow}
      </span>,
    );
  if (repo.switch === "unread") say("unread", "GitHub didn't answer for its variables, so this tries again within a minute.");
  if (repo.switch === "refused") say("refused", "GitHub won't show you its variables. Switching needs write access to it.");
  if (ready && setRunner !== null && !canSwitch) say("device", "This device can't move CI.");
  if (repo.problem) say("problem", repo.problem);
  if (opens && !open)
    say(
      "open",
      <button type="button" className={link} onClick={() => setOpen(true)}>
        {toggle}
      </button>,
    );
  if (open && !stepsShown)
    say(
      "hide",
      <button type="button" className={link} onClick={() => setOpen(false)}>
        Hide
      </button>,
    );
  return (
    <div className="col-span-full grid grid-cols-subgrid items-center gap-y-0.5 py-2">
      <span className="truncate font-medium">{repo.repo}</span>
      {runs !== null ? (
        <div className="max-sm:hidden">
          <RunsBar runs={runs} />
        </div>
      ) : null}
      {stepsShown ? (
        <button type="button" className="justify-self-end text-muted-foreground text-xs hover:text-foreground" onClick={() => setOpen(false)}>
          Hide
        </button>
      ) : (
        <div className="justify-self-end">{switches("end")}</div>
      )}
      {said.length > 0 || moving || moved !== null || error !== null ? (
        <p className="col-span-full text-muted-foreground text-xs">
          {moving ? <span>Moving </span> : null}
          {moved !== null && !moving ? (
            <span>
              <span className="text-foreground">Moved to {moved.to ?? "GitHub"}.</span> New runs start there; jobs already waiting stay put.{" "}
              {undoable ? (
                <button type="button" className={link} onClick={() => choose(moved.variable, moved.to, moved.from)}>
                  Undo
                </button>
              ) : null}{" "}
            </span>
          ) : null}
          {error !== null ? <span className="text-destructive">{error} </span> : null}
          {said}
        </p>
      ) : null}
      {open ? (
        <div className="col-span-full pt-1.5">
          <MoveCiSteps repo={repo} landed={landed} choose={repo.switch === "approve" ? <span className="text-warning text-xs">{owner} hasn't allowed Runnerbox to set variables. {allow}</span> : switches("start")} />
        </div>
      ) : null}
    </div>
  );
}
