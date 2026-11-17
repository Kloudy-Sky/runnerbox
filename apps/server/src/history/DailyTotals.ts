import type { DayTotals, ReviewError } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ReviewStore from "../reviews/ReviewStore.ts";
import { totalsByDay } from "./totalsByDay.ts";
import * as StateLogs from "./StateLogs.ts";

const DAY_MS = 24 * 60 * 60_000;

// Jobs and reviews per day over the last `days`, for the Overview's charts. Jobs come from every
// repo with a job log, as `JobHistory.overview` reads them, and reviews from every pull request kept.
export class DailyTotals extends Context.Service<
  DailyTotals,
  {
    readonly days: (days: number) => Effect.Effect<ReadonlyArray<DayTotals>, StateLogs.LogReadError | ReviewError>;
  }
>()("runnerbox/server/DailyTotals") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const store = yield* ReviewStore.ReviewStore;

  const days = Effect.fn("DailyTotals.days")(function* (days: number) {
    const now = yield* Clock.currentTimeMillis;
    return totalsByDay({ jobs: yield* logs.allJobs(now - days * DAY_MS), reviews: yield* store.all, now, days });
  });

  return DailyTotals.of({ days });
});

export const layer = Layer.effect(DailyTotals, make);
