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
