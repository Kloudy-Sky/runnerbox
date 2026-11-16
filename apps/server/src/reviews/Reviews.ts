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
import * as GitHubApp from "./GitHubApp.ts";
import { pullsOf } from "./pullRequests.ts";
import { DEFAULT_REVIEW_MODEL, offersReviewModel, REVIEW_MODELS } from "./reviewModels.ts";
import * as ReviewStore from "./ReviewStore.ts";

// Which repositories the owner turned reviews on for and the model that reviews, in
// `.server/reviews.json`, and the open pull requests on them, each with its newest review. GitHub is asked when a client asks, with the last ETag for each repository, so
// a list that hasn't changed costs nothing against the App's budget.

const SettingsFile = Schema.Struct({ v: Schema.Literal(1), repos: Schema.Array(Schema.String), model: Schema.optionalKey(Schema.String) });
type SettingsFile = typeof SettingsFile.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(SettingsFile));
const NONE: SettingsFile = { v: 1, repos: [] };
const PULLS_PER_REPO = 50;

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
  const withReview = (pull: PullRequest) => store.list(pull.repo, pull.number).pipe(Effect.map(([newest]) => (newest === undefined ? pull : { ...pull, review: summary(newest) })));

  const status = Effect.fn("Reviews.status")(function* (may: May) {
    const described = yield* app.describe;
    const file = yield* read;
    const shared = { canConfigure: may.configure, canReview: may.review, model: modelOf(file), models: REVIEW_MODELS };
    if (described === null) return { app: null, repos: [], pulls: [], problem: null, checkedAt: null, ...shared };
    const on = new Set(file.repos);
    const installed = yield* app.installed;
    const pulls: PullRequest[] = [];
    let problem = installed.problem;
    for (const { repo, token } of installed.repos) {
      if (!on.has(repo)) continue;
      const reply = yield* Effect.promise(() => github.get(`repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${PULLS_PER_REPO}`, token));
      const found = reply.kind === "ok" ? pullsOf(repo, reply.body) : null;
      if (found === null) problem ??= `Couldn't read the pull requests on ${repo}.`;
      else pulls.push(...found);
    }
    github.prune();
    return {
      app: described,
      repos: installed.repos.map(({ repo }) => ({ repo, review: on.has(repo) })),
      pulls: yield* Effect.forEach(pulls.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), withReview),
      problem,
      checkedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      ...shared,
    };
  });

  const connect = (appId: string, privateKey: string, may: May) => app.connect(appId, privateKey).pipe(Effect.andThen(status(may)));
  const disconnect = (may: May) => app.disconnect.pipe(Effect.andThen(status(may)));

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
        yield* write({ ...file, repos: review ? [...others, repo].toSorted() : others });
      }),
    );
    return yield* status(may);
  });

  const setModel = Effect.fn("Reviews.setModel")(function* (model: string, may: May) {
    if (!offersReviewModel(model)) return yield* new ReviewError({ reason: "model_not_offered" });
    yield* lock.withPermits(1)(read.pipe(Effect.flatMap((file) => write({ ...file, model }))));
    return yield* status(may);
  });

  return Reviews.of({ status, connect, disconnect, setRepo, setModel, settings });
});

export const layer = Layer.effect(Reviews, make);
