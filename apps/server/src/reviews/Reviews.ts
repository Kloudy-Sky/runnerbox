import { join } from "node:path";
import { type PullRequest, ReviewError, type ReviewsView } from "@runnerbox/contracts";
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

// Which repositories the owner turned reviews on for, in `.server/reviews.json`, and the open pull
// requests on them. GitHub is asked when a client asks, with the last ETag for each repository, so
// a list that hasn't changed costs nothing against the App's budget.

const SettingsFile = Schema.Struct({ v: Schema.Literal(1), repos: Schema.Array(Schema.String) });
type SettingsFile = typeof SettingsFile.Type;
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(SettingsFile));
const NONE: SettingsFile = { v: 1, repos: [] };
const PULLS_PER_REPO = 50;

export class Reviews extends Context.Service<
  Reviews,
  {
    readonly status: (canConfigure: boolean) => Effect.Effect<ReviewsView, ReviewError>;
    readonly connect: (appId: string, privateKey: string) => Effect.Effect<ReviewsView, ReviewError>;
    // Forgets the App's key. Which repositories were on is kept, for the next App connected.
    readonly disconnect: Effect.Effect<ReviewsView, ReviewError>;
    readonly setRepo: (repo: string, review: boolean) => Effect.Effect<ReviewsView, ReviewError>;
  }
>()("runnerbox/server/reviews/Reviews") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const { apiBase } = yield* QueueConfig;
  const app = yield* GitHubApp.GitHubApp;
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

  const status = Effect.fn("Reviews.status")(function* (canConfigure: boolean) {
    const described = yield* app.describe;
    if (described === null) return { app: null, repos: [], pulls: [], problem: null, checkedAt: null, canConfigure };
    const on = new Set((yield* read).repos);
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
      pulls: pulls.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
      problem,
      checkedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      canConfigure,
    };
  });

  const connect = (appId: string, privateKey: string) => app.connect(appId, privateKey).pipe(Effect.andThen(status(true)));
  const disconnect = app.disconnect.pipe(Effect.andThen(status(true)));

  const setRepo = Effect.fn("Reviews.setRepo")(function* (repo: string, review: boolean) {
    if ((yield* app.describe) === null) return yield* new ReviewError({ reason: "not_connected" });
    // Only a repository the App is installed on can be turned on. Any can be turned off. When
    // GitHub couldn't say where it's installed, that is the answer, not that it isn't there.
    if (review) {
      const installed = yield* app.installed;
      if (!installed.repos.some((each) => each.repo === repo)) return yield* new ReviewError({ reason: installed.problem === null ? "unknown_repo" : "github_unreachable" });
    }
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const others = (yield* read).repos.filter((each) => each !== repo);
        yield* write({ v: 1, repos: review ? [...others, repo].toSorted() : others });
      }),
    );
    return yield* status(true);
  });

  return Reviews.of({ status, connect, disconnect, setRepo });
});

export const layer = Layer.effect(Reviews, make);
