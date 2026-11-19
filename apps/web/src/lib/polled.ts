import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";

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

// Asks on a schedule, for a view that says when it can't be read: each answer replaces the last,
// and a failure shows beside the last answer until the next ask answers, while the asking goes on.
// An atom built on it reads its results through `latest`.
export const polledOrFailed = <A, E>(effect: Effect.Effect<A, E>, every: Duration.Input) =>
  Stream.fromEffectSchedule(Effect.exit(effect), Schedule.spaced(every)).pipe(
    Stream.mapAccum(
      (): AsyncResult.AsyncResult<A, E> => AsyncResult.initial(),
      (last, exit) => {
        const next: AsyncResult.AsyncResult<A, E> = Exit.isSuccess(exit) ? AsyncResult.success<A, E>(exit.value) : AsyncResult.failureWithPrevious(exit.cause, { previous: Option.some(last) });
        return [next, [next]];
      },
    ),
  );

// An atom over `polledOrFailed`'s results, holding the latest as its own. The stream itself never
// fails; its atom's own error, a stream that ended without an answer, can't happen either.
export const latest = <A, E, Never>(results: Atom.Atom<AsyncResult.AsyncResult<AsyncResult.AsyncResult<A, E>, Never>>) => Atom.map(results, (outer) => AsyncResult.flatMap(outer, (inner) => inner));
