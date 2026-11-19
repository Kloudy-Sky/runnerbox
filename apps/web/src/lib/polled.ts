import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

// Asks now and then on a schedule. A failure asks again on the same schedule instead of ending the
// stream, so one bad answer doesn't stop the asking; a defect, such as a method the server doesn't
// know, still ends it, so a view can say the server is older.
export const polled = <A, E>(effect: Effect.Effect<A, E>, every: Duration.Input) =>
  Stream.fromEffectSchedule(effect, Schedule.spaced(every)).pipe(Stream.retry(Schedule.spaced(every)));
