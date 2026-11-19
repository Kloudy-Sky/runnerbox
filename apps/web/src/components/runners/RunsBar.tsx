import type { RepoRuns } from "@runnerbox/contracts";

// Where a repository's jobs ran over the page's range: a bar split between here and GitHub, with
// the counts under it, so a move can be checked against where runs went next. Before the counts
// are known, the bar is empty and says nothing, rather than that no jobs ran.
export function RunsBar({ runs }: { runs: RepoRuns | "unknown" }) {
  const here = runs === "unknown" ? 0 : runs.here;
  const github = runs === "unknown" ? 0 : runs.github;
  const total = here + github;
  const words = runs === "unknown" ? "" : total === 0 ? "No jobs ran" : [here > 0 ? `${here} here` : null, github > 0 ? `${github} on GitHub` : null].filter(Boolean).join(", ");
  return (
    <div className="flex min-w-0 flex-col gap-1" title={words || undefined}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/10">
        {here > 0 ? <span className="bg-foreground/90" style={{ width: `${(here / total) * 100}%` }} /> : null}
        {github > 0 ? <span className="bg-foreground/30" style={{ width: `${(github / total) * 100}%` }} /> : null}
      </div>
      <span className="truncate text-[11px] text-muted-foreground tabular-nums">{words || " "}</span>
    </div>
  );
}
