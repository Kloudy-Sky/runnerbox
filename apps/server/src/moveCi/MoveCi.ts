import type { CiJob, CiRepo, GitHubError, MoveCiView } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as GitHub from "../github/GitHub.ts";
import { createGitHubReader } from "../github/githubReader.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { unifiedDiff } from "./unifiedDiff.ts";
import { applyEdits, workflowJobs } from "./workflowJobs.ts";

// Every repository the App is installed on, read for Move CI: the workflow files on its default
// branch, through the Contents read the App has, each job's runner, and the patch for the jobs that
// don't read a runner variable yet. GitHub is asked at most once a minute, with the last ETag for
// each path, so files that haven't changed cost nothing against the owner's budget.

const decodeListing = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ type: Schema.String, path: Schema.String })));
const decodeFile = Schema.decodeUnknownOption(Schema.Struct({ encoding: Schema.String, content: Schema.String }));

// Only a workflow's own path goes into a request, so a name GitHub gives can't reach another one.
const WORKFLOW = /^\.github\/workflows\/[\w.-]+\.ya?ml$/;
const MAX_WORKFLOWS = 50;
const FRESH_MS = 60_000;
const REPOS_AT_ONCE = 4;

type Looked = { readonly at: number; readonly repos: string; readonly view: MoveCiView };

export class MoveCi extends Context.Service<MoveCi, { readonly status: Effect.Effect<MoveCiView, GitHubError> }>()("runnerbox/server/moveCi/MoveCi") {}

const make = Effect.gen(function* () {
  const { apiBase } = yield* QueueConfig;
  const github = yield* GitHub.GitHub;
  const reader = createGitHubReader(apiBase);
  // One look at a time, so two clients asking together ask GitHub once, and a prune never drops what another look is using.
  const lock = yield* Semaphore.make(1);
  let looked: Looked | null = null;

  const get = (path: string, token: string) => Effect.promise(() => reader.get(path, token));

  const readRepo = Effect.fn("MoveCi.readRepo")(function* (repo: string, token: string) {
    const unread: CiRepo = { repo, jobs: [], patch: null, problem: `Couldn't read the workflows on ${repo}.` };
    const listed = yield* get(`repos/${repo}/contents/.github/workflows`, token);
    if (listed.kind === "missing") return { repo, jobs: [], patch: null, problem: null } satisfies CiRepo;
    const listing = listed.kind === "ok" ? decodeListing(listed.body) : Option.none();
    if (Option.isNone(listing)) return unread;
    const paths = listing.value.flatMap(({ type, path }) => (type === "file" && WORKFLOW.test(path) ? [path] : [])).toSorted();
    const jobs: CiJob[] = [];
    const diffs: string[] = [];
    const skipped: string[] = [];
    for (const path of paths.slice(0, MAX_WORKFLOWS)) {
      const reply = yield* get(`repos/${repo}/contents/${path}`, token);
      const file = reply.kind === "ok" ? decodeFile(reply.body) : Option.none();
      // A file over GitHub's 1 MB for this endpoint comes back with no content.
      const text = Option.isSome(file) && file.value.encoding === "base64" ? Buffer.from(file.value.content, "base64").toString("utf8") : null;
      const scanned = text === null ? null : workflowJobs(text);
      if (text === null || scanned === null) {
        skipped.push(path);
        continue;
      }
      jobs.push(...scanned.jobs.map((job) => ({ workflow: path, ...job })));
      if (scanned.edits.length > 0) diffs.push(unifiedDiff(path, text, applyEdits(text, scanned.edits)));
    }
    const more = paths.length - MAX_WORKFLOWS;
    const problem = skipped.length > 0 ? `Couldn't read ${skipped.join(", ")}, so its jobs aren't listed.` : more > 0 ? `Only the first ${MAX_WORKFLOWS} workflows were read.` : null;
    return { repo, jobs, patch: diffs.length > 0 ? diffs.join("") : null, problem } satisfies CiRepo;
  });

  const status = lock.withPermits(1)(
    Effect.gen(function* () {
      const reached = yield* github.reach;
      if (reached === null) return { app: null, repos: [], problem: null } satisfies MoveCiView;
      const now = yield* Clock.currentTimeMillis;
      const repos = reached.repos.join(" ");
      if (looked !== null && looked.repos === repos && now - looked.at < FRESH_MS) return looked.view;
      const read = yield* Effect.forEach(reached.repos, (repo) => readRepo(repo, reached.token), { concurrency: REPOS_AT_ONCE });
      reader.prune();
      // A repository with no workflows has nothing to move.
      const view: MoveCiView = { app: reached.app, repos: read.filter((repo) => repo.jobs.length > 0 || repo.problem !== null), problem: reached.problem };
      looked = { at: now, repos, view };
      return view;
    }),
  );

  return MoveCi.of({ status });
});

export const layer = Layer.effect(MoveCi, make);
