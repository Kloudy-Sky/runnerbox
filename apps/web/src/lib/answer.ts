import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

// An atom's result as a page reads it: what it last answered, whether that's the latest, and
// whether the last ask failed, with why.
export const answerOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) => ({
  data: Option.getOrUndefined(AsyncResult.value(result)),
  isSuccess: AsyncResult.isSuccess(result),
  isError: AsyncResult.isFailure(result),
  error: AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null,
});
