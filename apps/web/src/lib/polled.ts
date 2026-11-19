import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

// A quicker pace while the last answer says something is under way, such as a review running.
type Sooner<A> = { readonly every: Duration.Input; readonly when: (last: A) => boolean };

// Asks now and then on a schedule, or `sooner` while its `when` holds for the last answer. A
// failure asks again on the usual schedule instead of ending the stream, so one bad answer doesn't
// stop the asking; a defect, such as a method the server doesn't know, still ends it, so a view
// can say the server is older.
export const polled = <A, E>(effect: Effect.Effect<A, E>, every: Duration.Input, sooner?: Sooner<A>) =>
  Stream.fromEffectSchedule(
    effect,
    Schedule.spaced(every).pipe(Schedule.modifyDelay<number, A>(({ input, duration }) => Effect.succeed(sooner?.when(input) ? sooner.every : duration))),
  ).pipe(Stream.retry(Schedule.spaced(every)));

// Asks on a schedule as `polled` does, for a view that says when it can't be read: a failed ask is
// tried once more, then the failure ends the stream, beside what it last answered. The count
// starts again after each answer, so one bad answer between good ones never shows.
export const polledOrFailed = <A, E>(effect: Effect.Effect<A, E>, every: Duration.Input) =>
  Stream.fromEffectSchedule(effect, Schedule.spaced(every)).pipe(Stream.retry(Schedule.max([Schedule.spaced("3 seconds"), Schedule.recurs(1)])));
