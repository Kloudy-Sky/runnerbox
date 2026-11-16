import { join } from "node:path";
import type { ReviewError, ReviewsView } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { autoBudget, wantsReview } from "./autoReview.ts";
import * as ReviewRuns from "./ReviewRuns.ts";
import * as Reviews from "./Reviews.ts";
import * as ReviewStore from "./ReviewStore.ts";

// Reviews a pull request when it opens and on every push, without anyone pressing Review. Once a
// minute it reads the open pull requests on the repositories with reviews on and starts a review
// of each commit that autoReview.ts says wants one. When it started each is kept in
// `.server/review-auto.json`, so the day's limit holds across restarts.

const CHECK_EVERY = "1 minute";
const StartsFile = Schema.Struct({ v: Schema.Literal(1), started: Schema.Array(Schema.String) });
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(StartsFile));

export class ReviewWatch extends Context.Service<
  ReviewWatch,
  {
    // One pass, which also runs every minute.
    readonly check: Effect.Effect<void>;
    // The reviews view, with whether the day's limit has paused the pass.
    readonly status: (may: Reviews.May) => Effect.Effect<ReviewsView, ReviewError>;
  }
>()("runnerbox/server/reviews/ReviewWatch") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const reviews = yield* Reviews.Reviews;
  const store = yield* ReviewStore.ReviewStore;
  const runs = yield* ReviewRuns.ReviewRuns;
  const path = join(serverDir, "review-auto.json");
  const checking = yield* Semaphore.make(1);

  // A file that's missing or unreadable counts as no starts: the limit then only holds from now.
  const started = fs.readFileString(path).pipe(
    Effect.map((text) => Option.match(decodeFile(text), { onNone: () => [], onSome: (file) => file.started })),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  );
  const budget = Effect.gen(function* () {
    return autoBudget(yield* started, yield* Clock.currentTimeMillis);
  });

  const pass = Effect.gen(function* () {
    const { pulls, since } = yield* reviews.open;
    for (const pull of pulls) {
      const now = yield* Clock.currentTimeMillis;
      if (!wantsReview(pull, { since: since[pull.repo], reviews: yield* store.list(pull.repo, pull.number), now })) continue;
      const { recent, room } = yield* budget;
      if (!room) return;
      // Counted only once it has started. One that couldn't, such as while an earlier commit's review
      // still runs or with Claude signed out, is tried again next pass and doesn't hold up the rest.
      if ((yield* Effect.exit(runs.start(pull.repo, pull.number)))._tag === "Failure") continue;
      yield* fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify({ v: 1, started: [...recent, new Date(now).toISOString()] })}\n`)));
    }
  });
  // A pass that fails, with GitHub down or a file unreadable, is tried again in a minute.
  const check = checking.withPermits(1)(pass.pipe(Effect.ignore));

  const status = (may: Reviews.May) => Effect.all([reviews.status(may), budget]).pipe(Effect.map(([view, { room }]) => ({ ...view, autoPaused: !room })));

  yield* Effect.forkScoped(check.pipe(Effect.repeat(Schedule.spaced(CHECK_EVERY))));
  return ReviewWatch.of({ check, status });
});

export const layer = Layer.effect(ReviewWatch, make);
