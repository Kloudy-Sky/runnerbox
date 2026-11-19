import { type CiJob, type CiRepo, type CiRunner, type GitHubError, MoveCiError, type MoveCiView, type RunnerVariable } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as GitHub from "../github/GitHub.ts";
import { createGitHubReader } from "../github/githubReader.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { readVariables, writeVariable } from "./runnerVariables.ts";
import { unifiedDiff } from "./unifiedDiff.ts";
import { applyEdits, workflowJobs } from "./workflowJobs.ts";

// Every repository the App is installed on, read for Move CI: the workflow files on its default
// branch, through the Contents read the App has, each job's runner, and the patch for the jobs that
// don't read a runner variable yet. Where jobs do, and the install has accepted the Variables
// permission, the variables' values too, and `setRunner` sets or deletes one. GitHub is asked at
// most once a minute, with the last ETag for each path, so what hasn't changed costs nothing
// against the owner's budget. A 404 has no ETag, so a repository without workflows is believed for
// ten minutes before it's asked again, and once GitHub says to wait, nothing is asked until then
// and the last rows known stand in.

const decodeListing = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ type: Schema.String, path: Schema.String })));
const decodeFile = Schema.decodeUnknownOption(Schema.Struct({ encoding: Schema.String, content: Schema.String }));

// Only a workflow's own path goes into a request, so a name GitHub gives can't reach another one.
const WORKFLOW = /^\.github\/workflows\/[\w.-]+\.ya?ml$/;
// The launcher's own pattern for a label, which is all a variable is ever set to.
const LABEL = /^[\w.-]{1,100}$/;
const MAX_WORKFLOWS = 50;
const FRESH_MS = 60_000;
const NO_WORKFLOWS_FRESH_MS = 10 * 60_000;
const REPOS_AT_ONCE = 4;

type Looked = { readonly at: number; readonly repos: string; readonly app: NonNullable<MoveCiView["app"]>; readonly rows: ReadonlyArray<CiRepo>; readonly problem: string | null };
export type May = { readonly switch: boolean };

// The runner kinds of every install on this machine, each label once. A kind on the host is a Mac.
const runnersOf = (kinds: ReadonlyArray<{ readonly label: string; readonly docker?: boolean; readonly runsIn?: string }>): ReadonlyArray<CiRunner> => {
  const byLabel = new Map<string, CiRunner>();
  for (const { label, docker, runsIn } of kinds) if (LABEL.test(label) && !byLabel.has(label)) byLabel.set(label, { label, docker: docker === true, mac: runsIn === "host" });
  return [...byLabel.values()].toSorted((a, b) => a.label.localeCompare(b.label));
};

export class MoveCi extends Context.Service<
  MoveCi,
  {
    // `may` is what the asking session may do, which every view says back.
    readonly status: (may: May) => Effect.Effect<MoveCiView, GitHubError>;
    // Sets the repository's variable to one of this machine's labels, or deletes it for null, once
    // every job that reads it can run there.
    readonly setRunner: (repo: string, variable: RunnerVariable, label: string | null, may: May) => Effect.Effect<MoveCiView, GitHubError | MoveCiError>;
    // The view for a client that keeps it on screen: now, again after each look, and at once after
    // any session's switch, so every client watching sees a move when it's made. A look that
    // changes nothing pushes nothing.
    readonly changes: (may: May) => Stream.Stream<MoveCiView, GitHubError>;
  }
>()("runnerbox/server/moveCi/MoveCi") {}

const make = Effect.gen(function* () {
  const { apiBase } = yield* QueueConfig;
  const github = yield* GitHub.GitHub;
  const runnerState = yield* RunnerState.RunnerState;
  const reader = createGitHubReader(apiBase);
  // One look at a time, so two clients asking together ask GitHub once, and a prune never drops what another look is using.
  const lock = yield* Semaphore.make(1);
  let looked: Looked | null = null;
  // When each repository last answered that it has no workflows, and until when GitHub said to wait.
  const noWorkflows = new Map<string, number>();
  let waitUntil = 0;
  // Counted up by each switch, which starts every watcher's asking over.
  const switched = yield* SubscriptionRef.make(0);

  const get = (path: string, token: string) => Effect.promise(() => reader.get(path, token));

  // Null when GitHub said to wait, before or during the read.
  const readRepo = Effect.fn("MoveCi.readRepo")(function* (repo: string, reached: GitHub.Reach, now: number) {
    const { token } = reached;
    const none: CiRepo = { repo, jobs: [], patch: null, problem: null, switch: "nothing", variables: [], approveUrl: null };
    const unread: CiRepo = { ...none, problem: `Couldn't read the workflows on ${repo}.` };
    if (now < waitUntil) return null;
    if (now - (noWorkflows.get(repo) ?? Number.NEGATIVE_INFINITY) < NO_WORKFLOWS_FRESH_MS) return none;
    const listed = yield* get(`repos/${repo}/contents/.github/workflows`, token);
    if (listed.kind === "limited") {
      waitUntil = Math.max(waitUntil, listed.untilMs);
      return null;
    }
    if (listed.kind === "missing") {
      noWorkflows.set(repo, now);
      return none;
    }
    noWorkflows.delete(repo);
    const listing = listed.kind === "ok" ? decodeListing(listed.body) : Option.none();
    if (Option.isNone(listing)) return unread;
    const paths = listing.value.flatMap(({ type, path }) => (type === "file" && WORKFLOW.test(path) ? [path] : [])).toSorted();
    const jobs: CiJob[] = [];
    const diffs: string[] = [];
    const skipped: string[] = [];
    for (const path of paths.slice(0, MAX_WORKFLOWS)) {
      const reply = yield* get(`repos/${repo}/contents/${path}`, token);
      if (reply.kind === "limited") {
        waitUntil = Math.max(waitUntil, reply.untilMs);
        return null;
      }
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
    const read: CiRepo = { ...none, jobs, patch: diffs.length > 0 ? diffs.join("") : null, problem };
    const names = [...new Set(jobs.flatMap((job) => (job.state === "moves" && job.variable !== null ? [job.variable] : [])))].toSorted();
    if (names.length === 0) return read;
    const grant = reached.grants.get(repo);
    if (grant?.variablesWrite !== true) return { ...read, switch: "approve", approveUrl: grant?.manageUrl ?? null } satisfies CiRepo;
    const variables = yield* Effect.promise(() => readVariables(reader, repo, names, token));
    if (variables.kind === "limited") {
      waitUntil = Math.max(waitUntil, variables.untilMs);
      return null;
    }
    if (variables.kind !== "read") return { ...read, switch: variables.kind } satisfies CiRepo;
    return { ...read, switch: "ready", variables: variables.variables } satisfies CiRepo;
  });

  // The rows from the last look when it's fresh, or a new look. Null when the server isn't signed in.
  const look = lock.withPermits(1)(
    Effect.gen(function* () {
      const reached = yield* github.reach;
      if (reached === null) return null;
      const now = yield* Clock.currentTimeMillis;
      const repos = reached.repos.join(" ");
      if (looked !== null && looked.repos === repos && now - looked.at < FRESH_MS) return looked;
      const read = yield* Effect.forEach(reached.repos, (repo) => readRepo(repo, reached, now), { concurrency: REPOS_AT_ONCE });
      const waited = read.some((repo) => repo === null);
      // A prune would drop the ETags of the repositories a wait kept from being asked.
      if (!waited) reader.prune();
      const before = new Map(looked?.rows.map((row) => [row.repo, row]));
      const rows = read.flatMap((repo, index) => (repo !== null ? [repo] : (before.get(reached.repos[index] ?? "") ?? [])));
      const problem = waited ? "GitHub asked Runnerbox to wait, so some repositories are as they were last read." : reached.problem;
      // A repository with no workflows has nothing to move.
      looked = { at: now, repos, app: reached.app, rows: rows.filter((row) => row.jobs.length > 0 || row.problem !== null), problem };
      return looked;
    }),
  );

  // A machine whose runner state can't be read offers no runner to switch to, rather than failing the view.
  const runners = runnerState.current.pipe(
    Effect.map((installs) => runnersOf(installs.flatMap((install) => install.kinds))),
    Effect.orElseSucceed((): ReadonlyArray<CiRunner> => []),
  );

  const status = Effect.fn("MoveCi.status")(function* (may: May) {
    const current = yield* look;
    if (current === null) return { app: null, repos: [], problem: null, runners: [], canSwitch: may.switch } satisfies MoveCiView;
    return { app: current.app, repos: current.rows, problem: current.problem, runners: yield* runners, canSwitch: may.switch } satisfies MoveCiView;
  });

  const setRunner = Effect.fn("MoveCi.setRunner")(function* (repo: string, variable: RunnerVariable, label: string | null, may: May) {
    const view = yield* status(may);
    const reached = yield* github.reach;
    if (view.app === null || reached === null) return yield* new MoveCiError({ reason: "not_signed_in" });
    if (!reached.repos.includes(repo)) return yield* new MoveCiError({ reason: "not_installed" });
    const row = view.repos.find((each) => each.repo === repo);
    const reading = row?.jobs.filter((job) => job.state === "moves" && job.variable === variable) ?? [];
    if (row === undefined || reading.length === 0) return yield* new MoveCiError({ reason: "not_read" });
    if (label === null) {
      // With the repository's deleted, the organization's value would name the runner instead, so
      // a delete waits for a clean read that says it sets none.
      if (row.switch !== "ready") return yield* new MoveCiError({ reason: "org_unknown" });
      if (row.variables.some((each) => each.name === variable && each.org !== null)) return yield* new MoveCiError({ reason: "org_sets" });
    } else {
      const runner = view.runners.find((each) => each.label === label && each.mac === (variable === "MAC_RUNNER"));
      if (runner === undefined) return yield* new MoveCiError({ reason: "unknown_label" });
      if (!runner.docker && reading.some((job) => job.docker !== null)) return yield* new MoveCiError({ reason: "needs_docker" });
    }
    const written = yield* Effect.promise(() => writeVariable(apiBase, repo, variable, label, reached.token));
    if (written !== "done") return yield* new MoveCiError({ reason: written === "unreachable" ? "github_unreachable" : "refused" });
    // The next look reads it back from GitHub; until then the row says what was just written.
    const others = row.variables.filter((each) => each.name !== variable);
    const now = { name: variable, value: label, org: row.variables.find((each) => each.name === variable)?.org ?? null };
    const moved = (each: CiRepo): CiRepo => (each.repo !== repo ? each : { ...each, switch: "ready", approveUrl: null, variables: [...others, now].toSorted((a, b) => a.name.localeCompare(b.name)) });
    if (looked !== null) looked = { ...looked, rows: looked.rows.map(moved) };
    yield* SubscriptionRef.update(switched, (count) => count + 1);
    return { ...view, repos: view.repos.map(moved) };
  });

  // Each watcher asks on the look's own pace, so however many watch, GitHub is still asked at most
  // once a minute.
  const changes = (may: May) =>
    SubscriptionRef.changes(switched).pipe(
      Stream.switchMap(() => Stream.fromEffectSchedule(status(may), Schedule.spaced(FRESH_MS))),
      Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    );

  return MoveCi.of({ status, setRunner, changes });
});

export const layer = Layer.effect(MoveCi, make);
