import type { CiJob, CiRepo, DockerUse } from "@runnerbox/contracts";
import { Check } from "lucide-react";
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

function Step({ number, done, title, children }: { number: number; done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2.5">
      <span
        aria-label={done ? "done" : undefined}
        className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums", done ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : number}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={cn("pt-px", done && "text-muted-foreground")}>{title}</span>
        {children}
      </div>
    </li>
  );
}

// A repository's setup, opened in its row: copy the patch, commit it, choose where it runs. Runnerbox
// never commits it; it reads the default branch, and once the change is there, which `landed` says,
// the first two steps tick and the third's switch works. Under the steps, the jobs to know about:
// which need Docker, and which the patch leaves alone. `choose` is the third step's control.
export function MoveCiSteps({ repo, landed, choose }: { repo: CiRepo; landed: boolean; choose: ReactNode }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const patched = repo.jobs.filter((job) => job.state === "patched");
  const files = new Set(patched.map((job) => job.workflow)).size;
  const docker = repo.jobs.filter((job): job is CiJob & { docker: DockerUse } => job.docker !== null);
  const left = repo.jobs.filter((job) => job.state === "left");
  const name = (job: CiJob) => <span className="font-medium">{job.job}</span>;
  return (
    <div className="flex flex-col gap-3 rounded-md bg-foreground/[0.03] px-3 py-3">
      {repo.patch !== null || landed ? (
        <ol className="flex flex-col gap-3.5">
          <Step number={1} done={landed} title="Copy the change">
            {repo.patch !== null ? (
              <>
                <p className="text-muted-foreground text-xs">
                  {patched.length === 1 ? "1 job" : `${patched.length} jobs`} in {files === 1 ? "1 file" : `${files} files`}. Each keeps its GitHub runner until the variable is set.
                </p>
                <pre className="max-h-[28rem] overflow-auto rounded-md bg-background py-2 font-mono text-xs leading-relaxed">
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
              </>
            ) : null}
          </Step>
          <Step number={2} done={landed} title="Commit it to the default branch">
            {landed ? null : <p className="text-muted-foreground text-xs">Runnerbox never writes code. It reads the default branch and ticks this off once the change is there.</p>}
          </Step>
          <Step number={3} done={false} title="Choose where it runs">
            <div>{choose}</div>
          </Step>
        </ol>
      ) : null}
      {docker.length > 0 || left.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs">
          {docker.map((job) => (
            <li key={`docker-${job.workflow}-${job.job}`} className="text-warning">
              {name(job)} {DOCKER[job.docker]}, so it needs a runner kind with Docker.
            </li>
          ))}
          {left.map((job) => (
            <li key={`left-${job.workflow}-${job.job}`} className="text-muted-foreground">
              {name(job)} picks its runner with <span className="font-mono">{job.runsOn}</span>, so it's left alone.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
