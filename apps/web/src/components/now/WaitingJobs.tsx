import { opensInBrowser } from "@runnerbox/client-runtime";
import type { QueueView } from "@runnerbox/contracts";
import { formatAge } from "../../lib/format.ts";

// Jobs GitHub has queued for this machine's runners, the longest waiting first. Names are the
// repo's own text, so they're shown as plain text, and a job links to GitHub only when its address
// is a github.com page. A slow or stopped check says so in words.
export function WaitingJobs({ queue, now }: { queue: QueueView; now: number }) {
  const missing = queue.reposLeftOut + queue.runsLeftOut > 0;
  return (
    <div className="flex flex-col gap-1">
      {queue.waiting.length === 0 ? <p className="text-muted-foreground">Nothing is waiting for a runner.</p> : null}
      {queue.waiting.map((job) => {
        const name = job.workflow ? `${job.workflow} / ${job.job}` : job.job;
        return (
          <div key={`${job.repo}-${job.since}-${job.job}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
            <span className="truncate">
              {job.url && opensInBrowser(job.url) ? (
                <a href={job.url} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
                  {name}
                </a>
              ) : (
                name
              )}
              <span className="text-muted-foreground"> · {job.repo}</span>
            </span>
            <span className="text-muted-foreground tabular-nums">for {formatAge(job.since, now)}</span>
          </div>
        );
      })}
      {queue.reason ? <p className="text-muted-foreground">{queue.reason}</p> : null}
      {missing ? <p className="text-muted-foreground">Some repositories or runs weren't checked, so a waiting job may be missing.</p> : null}
    </div>
  );
}
