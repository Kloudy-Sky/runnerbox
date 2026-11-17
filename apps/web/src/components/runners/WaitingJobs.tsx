import { opensInBrowser } from "@runnerbox/client-runtime";
import { formatAge } from "../../lib/format.ts";
import { type MachineQueue, waitingEverywhere, waitingKey } from "../../lib/waitingEverywhere.ts";

// Jobs GitHub has queued for the machines' runners, the longest waiting first. Names are the repo's
// own text, so they're shown as plain text, and a job links to GitHub only when its address is a
// github.com page. How long each has waited is measured; when it will start isn't known, so it
// isn't said. A slow or stopped check says so in words.
export function WaitingJobs({ queues, now }: { queues: ReadonlyArray<MachineQueue>; now: number }) {
  const waiting = waitingEverywhere(queues);
  const missing = queues.some(({ queue }) => queue.reposLeftOut + queue.runsLeftOut > 0);
  return (
    <div className="flex flex-col gap-1">
      {waiting.length === 0 ? <p className="text-muted-foreground">Nothing is waiting for a runner.</p> : null}
      {waiting.map(({ job, machines }) => {
        const name = job.workflow ? `${job.workflow} / ${job.job}` : job.job;
        return (
          <div key={waitingKey(job)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
            <span className="truncate">
              {job.url && opensInBrowser(job.url) ? (
                <a href={job.url} target="_blank" rel="noreferrer noopener" className="font-medium underline-offset-2 hover:underline">
                  {name}
                </a>
              ) : (
                <span className="font-medium">{name}</span>
              )}
              <span className="text-muted-foreground">
                {" "}
                · {job.repo}
                {machines.length > 0 ? ` · ${machines.join(", ")}` : ""}
              </span>
            </span>
            <span className="text-muted-foreground tabular-nums">for {formatAge(job.since, now)}</span>
          </div>
        );
      })}
      {queues.flatMap(({ key, machine, queue }) =>
        queue.reason ? [<p key={key} className="text-muted-foreground">{machine ? `${machine}: ${queue.reason}` : queue.reason}</p>] : [],
      )}
      {missing ? <p className="text-muted-foreground">Some repositories or runs weren't checked, so a waiting job may be missing.</p> : null}
    </div>
  );
}
