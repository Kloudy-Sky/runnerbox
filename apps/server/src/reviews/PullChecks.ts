import type { Check } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { createGitHubReader } from "../github/githubReader.ts";
import * as StateLogs from "../history/StateLogs.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { allEnded, checksOf, type CommitJob, jobOfRecord, jobsOf, runsOf } from "./commitChecks.ts";

// Each open pull request's checks. This machine's job history answers for the runs it holds, at no
// cost, and GitHub is asked for the rest through the sign-in, which the App lets read Actions.
//
// What bounds the calls to GitHub: only when a client asks for the reviews view, only for its open
// pull requests, which are on repositories with reviews on, and a commit at most once per look at
// those pull requests (at most every 20 seconds, Reviews.ts). A commit whose runs have all ended
// isn't asked about again. One ask lists the commit's runs, then the jobs of each run history
// doesn't already hold ended. Every request repeats its last ETag, so an unchanged reply is a 304,
// which GitHub doesn't count, and a reply that isn't an answer stops the asking until the next look.

type Commit = { readonly repo: string; readonly headSha: string };
// What GitHub last said about a commit, with the jobs history held then, so a commit that ages out
// of the history read below keeps them.
type Answer = { readonly lookedAt: number; readonly jobs: ReadonlyArray<CommitJob>; readonly ended: boolean };

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 14;
// A commit with more runs than this shows the newest this many.
const RUNS_PER_COMMIT = 100;

export class PullChecks extends Context.Service<
  PullChecks,
  {
    // The checks of each commit given, by a lookup that's empty for one not given. `lookedAt` is when
    // the pull requests were last listed, which paces the asking.
    readonly of: (commits: ReadonlyArray<Commit>, token: string, lookedAt: number) => Effect.Effect<(commit: Commit) => ReadonlyArray<Check>>;
  }
>()("runnerbox/server/reviews/PullChecks") {}

const keyOf = ({ repo, headSha }: Commit) => `${repo}@${headSha}`;

const make = Effect.gen(function* () {
  const { apiBase } = yield* QueueConfig;
  const logs = yield* StateLogs.StateLogs;
  const reader = createGitHubReader(apiBase);
  const asking = yield* Semaphore.make(1);
  const answers = new Map<string, Answer>();

  // The jobs history recorded on each of the commits, by commit. A log that can't be read leaves GitHub to answer.
  const history = Effect.fn("PullChecks.history")(function* (commits: ReadonlyArray<Commit>) {
    const since = (yield* Clock.currentTimeMillis) - HISTORY_DAYS * DAY_MS;
    const wanted = new Set(commits.map(keyOf));
    const held = new Map<string, CommitJob[]>();
    for (const repo of new Set(commits.map((commit) => commit.repo))) {
      for (const record of yield* logs.jobs(repo, since).pipe(Effect.orElseSucceed(() => []))) {
        const key = keyOf({ repo, headSha: record.headSha ?? "" });
        if (wanted.has(key)) held.set(key, [...(held.get(key) ?? []), jobOfRecord(record)]);
      }
    }
    return held;
  });

  // GitHub's answer for one commit, or null when it gave none. Paths are built from a repository
  // the App is installed on, a checked commit ID and run IDs GitHub gave.
  const ask = Effect.fn("PullChecks.ask")(function* ({ repo, headSha }: Commit, held: ReadonlyArray<CommitJob>, token: string) {
    const listed = yield* Effect.promise(() => reader.get(`repos/${repo}/actions/runs?head_sha=${headSha}&per_page=${RUNS_PER_COMMIT}`, token));
    const runs = listed.kind === "ok" ? runsOf(listed.body) : null;
    if (runs === null) return null;
    const fetched: CommitJob[] = [];
    for (const run of runs) {
      if (run.ended && held.some((job) => job.runId === run.id && job.attempt === run.attempt)) continue;
      const reply = yield* Effect.promise(() => reader.get(`repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, token));
      const jobs = reply.kind === "ok" ? jobsOf(reply.body) : null;
      if (jobs === null) return null;
      fetched.push(...jobs);
    }
    return { jobs: [...held, ...fetched], ended: allEnded(runs, fetched) };
  });

  const of = (commits: ReadonlyArray<Commit>, token: string, lookedAt: number) =>
    asking.withPermits(1)(
      Effect.gen(function* () {
        const open = commits.filter((commit) => commit.headSha !== "");
        const keys = new Set(open.map(keyOf));
        for (const key of answers.keys()) if (!keys.has(key)) answers.delete(key);
        const held = yield* history(open);
        let answering = true;
        let asked = false;
        for (const commit of open) {
          const key = keyOf(commit);
          const known = answers.get(key);
          if (known !== undefined && (known.ended || known.lookedAt >= lookedAt)) continue;
          asked ||= answering;
          const answer = answering ? yield* ask(commit, held.get(key) ?? [], token) : null;
          if (answer === null) answering = false;
          answers.set(key, { lookedAt, ...(answer ?? { jobs: known?.jobs ?? [], ended: false }) });
        }
        // Only after asking, so the ETags of the commits still running are kept between looks.
        if (asked) reader.prune();
        return (commit: Commit) => {
          const key = keyOf(commit);
          return keys.has(key) ? checksOf([...(held.get(key) ?? []), ...(answers.get(key)?.jobs ?? [])]) : [];
        };
      }),
    );

  return PullChecks.of({ of });
});

export const layer = Layer.effect(PullChecks, make);
