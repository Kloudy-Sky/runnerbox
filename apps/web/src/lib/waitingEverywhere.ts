import type { QueueView, WaitingJob } from "@runnerbox/contracts";

// One machine's queue, with its name when the page shows several.
export type MachineQueue = { readonly key: string; readonly machine: string | null; readonly queue: QueueView };

// A job's URL names that one job; without one, every field it has.
export const waitingKey = (job: WaitingJob) => job.url ?? `${job.repo}-${job.workflow}-${job.since}-${job.job}-${job.label}`;

// Every machine's waiting jobs, the longest waiting first. Two machines that watch the same
// repository see the same queued job, so it's listed once, with every machine that sees it.
export function waitingEverywhere(queues: ReadonlyArray<MachineQueue>) {
  const byKey = new Map<string, { job: WaitingJob; machines: string[] }>();
  for (const { machine, queue } of queues) {
    for (const job of queue.waiting) {
      const held = byKey.get(waitingKey(job)) ?? { job, machines: [] };
      byKey.set(waitingKey(job), { job, machines: machine ? [...held.machines, machine] : held.machines });
    }
  }
  return [...byKey.values()].toSorted((a, b) => Date.parse(a.job.since) - Date.parse(b.job.since));
}
