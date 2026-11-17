import { join, sep } from "node:path";
import { Review, ReviewError } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";

// Each pull request's reviews, in `.server/reviews/<owner>/<name>/<number>.json`, owner-only, the
// newest first. A review is written when it starts and again as it ends.

const PullFile = Schema.Struct({ v: Schema.Literal(1), reviews: Schema.Array(Review) });
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(PullFile));
// Older reviews of a pull request are dropped past this many.
const KEPT_PER_PULL = 20;

export class ReviewStore extends Context.Service<
  ReviewStore,
  {
    readonly list: (repo: string, number: number) => Effect.Effect<ReadonlyArray<Review>, ReviewError>;
    // Every review kept, of every pull request, for totals across them.
    readonly all: Effect.Effect<ReadonlyArray<Review>, ReviewError>;
    // Adds the review, or replaces the one with its ID.
    readonly put: (review: Review) => Effect.Effect<void, ReviewError>;
    // Marks a review as one a fiber in this process is working on, until the effect it wraps ends.
    readonly live: <A, E, R>(id: string, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("runnerbox/server/reviews/ReviewStore") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const unreadable = () => new ReviewError({ reason: "unreadable" });
  const lock = yield* Semaphore.make(1);
  const working = new Set<string>();
  // `repo` has passed RepoName, so its two parts are safe as directory names.
  const dirOf = (repo: string) => join(serverDir, "reviews", ...repo.split("/"));
  const pathOf = (repo: string, number: number) => join(dirOf(repo), `${number}.json`);

  // A review still marked as going that no fiber here is working on was cut short by a restart.
  const settled = (review: Review): Review =>
    (review.state === "queued" || review.state === "running") && !working.has(review.id)
      ? { ...review, state: "failed", finishedAt: review.finishedAt ?? review.startedAt, problem: "The server stopped while this review was running. Run it again." }
      : review;

  const read = (repo: string, number: number) =>
    fs.readFileString(pathOf(repo, number)).pipe(
      Effect.map(Option.some),
      Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(Option.none<string>()) : Effect.fail(error))),
      Effect.flatMap((text) => (Option.isSome(text) ? decodeFile(text.value).pipe(Effect.map((file) => file.reviews)) : Effect.succeed<ReadonlyArray<Review>>([]))),
      Effect.mapError(unreadable),
    );

  const list = (repo: string, number: number) => read(repo, number).pipe(Effect.map((reviews) => reviews.map(settled)));

  // A pull request's file as `pathOf` names it, relative to the reviews directory. Anything else there is skipped.
  const pullOf = (path: string) => {
    const [owner, name, file, ...rest] = path.split(sep);
    const number = file?.match(/^(\d+)\.json$/)?.[1];
    return owner && name && number && rest.length === 0 ? [{ repo: `${owner}/${name}`, number: Number(number) }] : [];
  };
  const all = fs.readDirectory(join(serverDir, "reviews"), { recursive: true }).pipe(
    Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed<Array<string>>([]) : Effect.fail(error))),
    Effect.mapError(unreadable),
    Effect.map((paths) => paths.flatMap(pullOf)),
    Effect.flatMap((pulls) => Effect.forEach(pulls, ({ repo, number }) => list(repo, number))),
    Effect.map((lists) => lists.flat()),
  );

  const put = (review: Review) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const others = (yield* read(review.repo, review.number)).filter((each) => each.id !== review.id);
        const reviews = [review, ...others].toSorted((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, KEPT_PER_PULL);
        yield* fs.makeDirectory(dirOf(review.repo), { recursive: true, mode: 0o700 }).pipe(
          Effect.andThen(writeFileAtomic(fs, pathOf(review.repo, review.number), `${JSON.stringify({ v: 1, reviews })}\n`)),
          Effect.mapError(unreadable),
        );
      }),
    );

  const live = <A, E, R>(id: string, work: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => working.add(id)),
      () => work,
      () => Effect.sync(() => working.delete(id)),
    );

  return ReviewStore.of({ list, all, put, live });
});

export const layer = Layer.effect(ReviewStore, make);
