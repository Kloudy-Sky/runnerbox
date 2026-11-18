import type { CiJob, CiRepo, DockerUse } from "@runnerbox/contracts";
import type { ReactNode } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";

const DOCKER: Record<DockerUse, string> = {
  services: "uses services:",
  container: "runs in a container:",
  action: "uses a Docker action",
  command: "runs docker in a step",
};

// The patch's own lines, colored as a diff. The text is the repository's, so it's shown as plain text.
const lineClass = (line: string) =>
  line.startsWith("diff ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@") || line.startsWith("\\")
    ? "text-muted-foreground"
    : line.startsWith("+")
      ? "bg-success/10"
      : line.startsWith("-")
        ? "bg-destructive/10"
        : undefined;

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5">
      <span aria-hidden className="flex size-5 items-center justify-center rounded-full border border-border text-[11px] text-muted-foreground tabular-nums">
        {number}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-medium">{title}</span>
        {children}
      </div>
    </li>
  );
}

// A repository's setup, opened under its row: the patch and the commit that moves the jobs that
// don't read a runner variable yet, then what to know about the jobs: which need Docker, and which
// the patch leaves alone. Runnerbox never commits it; the row updates once it's on the default branch.
export function MoveCiSteps({ repo }: { repo: CiRepo }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const patched = repo.jobs.filter((job) => job.state === "patched");
  const files = new Set(patched.map((job) => job.workflow)).size;
  const docker = repo.jobs.filter((job): job is CiJob & { docker: DockerUse } => job.docker !== null);
  const left = repo.jobs.filter((job) => job.state === "left");
  const name = (job: CiJob) => <span className="font-medium">{job.job}</span>;
  return (
    <div className="flex flex-col gap-3 pt-2 pb-3 pl-5">
      {repo.patch !== null ? (
        <ol className="flex flex-col gap-4">
          <Step number={1} title="Copy the change">
            <p className="text-muted-foreground">
              {patched.length === 1 ? "1 job" : `${patched.length} jobs`} in {files === 1 ? "1 file" : `${files} files`}. Each keeps its GitHub runner until the variable is set.
            </p>
            <pre className="max-h-80 overflow-auto rounded-md bg-surface py-2 font-mono text-xs leading-relaxed">
              {repo.patch
                .trimEnd()
                .split("\n")
                .map((line, index) => (
                  <div key={index} className={cn("px-3", lineClass(line))}>
                    {line || " "}
                  </div>
                ))}
            </pre>
            <div>
              <Button size="sm" onClick={() => repo.patch !== null && copyToClipboard(repo.patch)}>
                {isCopied ? "Copied" : "Copy patch"}
              </Button>
            </div>
          </Step>
          <Step number={2} title="Commit it to the default branch">
            <p className="text-muted-foreground">Runnerbox never writes code. This row updates within a minute of the change landing.</p>
          </Step>
        </ol>
      ) : null}
      {docker.length > 0 || left.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {docker.map((job) => (
            <li key={`docker-${job.workflow}-${job.job}`} className="text-warning">
              {name(job)} {DOCKER[job.docker]}, so it needs a runner kind with Docker.
            </li>
          ))}
          {left.map((job) => (
            <li key={`left-${job.workflow}-${job.job}`} className="text-muted-foreground">
              {name(job)} picks its runner with <span className="font-mono text-xs">{job.runsOn}</span>, so it's left alone.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
