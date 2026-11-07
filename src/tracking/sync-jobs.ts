import type { GitHubJob, WorkflowRun } from "../github/github-client.ts";
import { type JobRecord, toJobRecord } from "./job-record.ts";

type JobSource = {
  runs(repo: string, day: string): AsyncIterable<WorkflowRun>;
  jobs(repo: string, runId: number): Promise<GitHubJob[]>;
};

type JobStore = {
  read(): Promise<JobRecord[]>;
  append(records: readonly JobRecord[]): Promise<void>;
};

type SyncOptions = {
  repo: string;
  since: Date;
  until: Date;
  source: JobSource;
  store: JobStore;
  onRunSynced: (added: number) => void;
};

const DAY_MS = 86_400_000;
const attemptKey = (runId: number, attempt: number) => `${runId}:${attempt}`;

// Copies jobs from GitHub to the store. It appends after every run, so an interrupted sync resumes
// where it stopped. A rerun has a new attempt number, which is how it gets fetched again.
export async function syncJobs({ repo, since, until, source, store, onRunSynced }: SyncOptions) {
  const existing = await store.read();
  const jobIds = new Set(existing.map((record) => record.jobId));
  const attempts = new Set(existing.map((record) => attemptKey(record.runId, record.attempt)));
  let added = 0;

  // GitHub caps filtered run lists, so asking one day at a time reaches further back.
  for (let time = startOfDay(since); time <= until.getTime(); time += DAY_MS) {
    const day = new Date(time).toISOString().slice(0, 10);

    for await (const run of source.runs(repo, day)) {
      if (attempts.has(attemptKey(run.id, run.run_attempt))) continue;

      const fresh = (await source.jobs(repo, run.id))
        .filter((job) => !jobIds.has(job.id))
        .map((job) => toJobRecord(repo, job));
      await store.append(fresh);

      for (const record of fresh) {
        jobIds.add(record.jobId);
        attempts.add(attemptKey(record.runId, record.attempt));
      }
      added += fresh.length;
      onRunSynced(added);
    }
  }

  return added;
}

function startOfDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
