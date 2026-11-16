import { join } from "node:path";
import { type PullRequest, type Review, ReviewError, type ReviewSummary, type ReviewsView } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { createGitHubReader } from "../github/githubReader.ts";
import { QueueConfig } from "../runners/QueueConfig.ts";
import { type ListedPull, skipOf } from "./autoReview.ts";
import * as GitHubApp from "./GitHubApp.ts";
import { pullsOf } from "./pullRequests.ts";
import { DEFAULT_REVIEW_MODEL, offersReviewModel, REVIEW_MODELS } from "./reviewModels.ts";
import * as ReviewStore from "./ReviewStore.ts";

// Which repositories the owner turned reviews on for and the model that reviews, in
// `.server/reviews.json`, and the open pull requests on them, each with its newest review. GitHub
// is asked when a client asks, at most every 20 seconds, with the last ETag for each repository, so
// a list that hasn't changed costs nothing against the App's budget.

// `since` is when each repository's reviews were turned on, which decides the pull requests reviewed unasked.
const SettingsFile = Schema.Struct({ v: Schema.Literal(1), repos: Schema.Array(Schema.String), model: Schema.optionalKey(Schema.String), since: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) });
type SettingsFile = typeof SettingsFile.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(SettingsFile));
const NONE: SettingsFile = { v: 1, repos: [] };
const PULLS_PER_REPO = 50;
// GitHub is asked for the lists at most this often, however often clients ask: an app polls faster
// while a review runs, and nothing stops a client asking in a loop.
const PULLS_FRESH_MS = 20_000;
type Looked = { readonly at: number; readonly repos: string; readonly pulls: ReadonlyArray<ListedPull>; readonly problem: string | null };

export type May = { readonly configure: boolean; readonly review: boolean };

export class Reviews extends Context.Service<
  Reviews,
  {
    // `may` is what the asking session may do, which every view says back.
    readonly status: (may: May) => Effect.Effect<ReviewsView, ReviewError>;
    readonly connect: (appId: string, privateKey: string, may: May) => Effect.Effect<ReviewsView, ReviewError>;
    // Forgets the App's key. Which repositories were on is kept, for the next App connected.
    readonly disconnect: (may: May) => Effect.Effect<ReviewsView, ReviewError>;
    readonly setRepo: (repo: string, review: boolean, may: May) => Effect.Effect<ReviewsView, ReviewError>;
    readonly setModel: (model: string, may: May) => Effect.Effect<ReviewsView, ReviewError>;
    // What a review starts from: the repositories with reviews on, and the model.
    readonly settings: Effect.Effect<{ readonly repos: ReadonlyArray<string>; readonly model: string }, ReviewError>;
    // The open pull requests on the repositories with reviews on, asked of GitHub now, and when each
    // repository was turned on. Empty when no App is connected. For the pass that reviews unasked.
    readonly open: Effect.Effect<{ readonly pulls: ReadonlyArray<ListedPull>; readonly since: Readonly<Record<string, string>> }, ReviewError>;
  }
>()("runnerbox/server/reviews/Reviews") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const { apiBase } = yield* QueueConfig;
  const app = yield* GitHubApp.GitHubApp;
  const store = yield* ReviewStore.ReviewStore;
  const github = createGitHubReader(apiBase);
  const path = join(serverDir, "reviews.json");
  const unreadable = () => new ReviewError({ reason: "unreadable" });
  const lock = yield* Semaphore.make(1);

  const read = fs.readFileString(path).pipe(
    Effect.map(Option.some),
    Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(Option.none<string>()) : Effect.fail(error))),
    Effect.flatMap((text) => (Option.isSome(text) ? decodeFile(text.value) : Effect.succeed(NONE))),
    Effect.mapError(unreadable),
  );
  const write = (file: SettingsFile) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(file, null, 2)}\n`)), Effect.mapError(unreadable));

  // A model the file names that reviews no longer offer reads as the default.
  const modelOf = (file: SettingsFile) => (file.model !== undefined && offersReviewModel(file.model) ? file.model : DEFAULT_REVIEW_MODEL);
  const settings = read.pipe(Effect.map((file) => ({ repos: file.repos, model: modelOf(file) })));

  const summary = (review: Review): ReviewSummary => ({
    id: review.id,
    state: review.state,
    headSha: review.headSha,
    startedAt: review.startedAt,
    finishedAt: review.finishedAt,
    score: review.score,
    impact: review.impact,
    p1: review.findings.filter((finding) => finding.priority === "P1").length,
    p2: review.findings.filter((finding) => finding.priority === "P2").length,
  });
  // A pull request as clients get it: what decides a skip stays here, and only the reason goes out.
  const shown = ({ bot: _bot, fork: _fork, ...pull }: ListedPull, skipped: ReturnType<typeof skipOf>): PullRequest => (skipped === null ? pull : { ...pull, skipped });
  const withReview = (listed: ListedPull) => {
    const pull = shown(listed, skipOf(listed));
    return store.list(pull.repo, pull.number).pipe(Effect.map(([newest]) => (newest === undefined ? pull : { ...pull, review: summary(newest) })));
  };

  let looked: Looked | null = null;
  const forget = Effect.sync(() => void (looked = null));

  // The open pull requests on the repositories with reviews on, from the last look when it's fresh
  // and was of the same repositories. `fresh` asks GitHub whatever the last look's age: only the
  // server's own pass does, once a minute.
  const look = Effect.fn("Reviews.look")(function* (reviewed: ReadonlyArray<GitHubApp.InstalledRepo>, fresh = false) {
    const now = yield* Clock.currentTimeMillis;
    const repos = reviewed.map(({ repo }) => repo).join(" ");
    if (!fresh && looked !== null && looked.repos === repos && now - looked.at < PULLS_FRESH_MS) return looked;
    const pulls: ListedPull[] = [];
    let problem: string | null = null;
    for (const { repo, token } of reviewed) {
      const reply = yield* Effect.promise(() => github.get(`repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${PULLS_PER_REPO}`, token));
      const found = reply.kind === "ok" ? pullsOf(repo, reply.body) : null;
      if (found === null) problem ??= `Couldn't read the pull requests on ${repo}.`;
      else pulls.push(...found);
    }
    github.prune();
    looked = { at: now, repos, pulls: pulls.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), problem };
    return looked;
  });

  const status = Effect.fn("Reviews.status")(function* (may: May) {
    const described = yield* app.describe;
    const file = yield* read;
    const shared = { canConfigure: may.configure, canReview: may.review, model: modelOf(file), models: REVIEW_MODELS };
    if (described === null) return { app: null, repos: [], pulls: [], problem: null, checkedAt: null, ...shared };
    const on = new Set(file.repos);
    const installed = yield* app.installed;
    const { pulls, problem, at } = yield* look(installed.repos.filter(({ repo }) => on.has(repo)));
    return {
      app: described,
      repos: installed.repos.map(({ repo }) => ({ repo, review: on.has(repo) })),
      // Each pull request's review is read now, so a running review shows as it changes between looks at GitHub.
      pulls: yield* Effect.forEach(pulls, withReview),
      problem: installed.problem ?? problem,
      checkedAt: new Date(at).toISOString(),
      ...shared,
    };
  });

  const connect = (appId: string, privateKey: string, may: May) => app.connect(appId, privateKey).pipe(Effect.andThen(forget), Effect.andThen(status(may)));
  const disconnect = (may: May) => app.disconnect.pipe(Effect.andThen(forget), Effect.andThen(status(may)));

  const setRepo = Effect.fn("Reviews.setRepo")(function* (repo: string, review: boolean, may: May) {
    if ((yield* app.describe) === null) return yield* new ReviewError({ reason: "not_connected" });
    // Only a repository the App is installed on can be turned on. Any can be turned off. When
    // GitHub couldn't say where it's installed, that is the answer, not that it isn't there.
    if (review) {
      const installed = yield* app.installed;
      if (!installed.repos.some((each) => each.repo === repo)) return yield* new ReviewError({ reason: installed.problem === null ? "unknown_repo" : "github_unreachable" });
    }
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const file = yield* read;
        const others = file.repos.filter((each) => each !== repo);
        // Turning it on again starts the clock again; a repository already on keeps its own.
        const { [repo]: was, ...since } = file.since ?? {};
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        yield* write({ ...file, repos: review ? [...others, repo].toSorted() : others, since: review ? { ...since, [repo]: file.repos.includes(repo) && was !== undefined ? was : now } : since });
      }),
    );
    return yield* status(may);
  });

  const setModel = Effect.fn("Reviews.setModel")(function* (model: string, may: May) {
    if (!offersReviewModel(model)) return yield* new ReviewError({ reason: "model_not_offered" });
    yield* lock.withPermits(1)(read.pipe(Effect.flatMap((file) => write({ ...file, model }))));
    return yield* status(may);
  });

  const open = Effect.gen(function* () {
    if ((yield* app.describe) === null) return { pulls: [], since: {} };
    // A repository turned on before this was kept counts as turned on now, so nothing already open is reviewed unasked.
    const file = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const kept = yield* read;
        const missing = kept.repos.filter((repo) => kept.since?.[repo] === undefined);
        if (missing.length === 0) return kept;
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        const stamped = { ...kept, since: { ...kept.since, ...Object.fromEntries(missing.map((repo) => [repo, now])) } };
        yield* write(stamped);
        return stamped;
      }),
    );
    // With no repository on, GitHub isn't asked anything.
    if (file.repos.length === 0) return { pulls: [], since: {} };
    const installed = yield* app.installed;
    const { pulls } = yield* look(installed.repos.filter(({ repo }) => file.repos.includes(repo)), true);
    return { pulls, since: file.since ?? {} };
  });

  return Reviews.of({ status, connect, disconnect, setRepo, setModel, settings, open });
});

export const layer = Layer.effect(Reviews, make);
