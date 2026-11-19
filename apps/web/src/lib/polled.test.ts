import assert from "node:assert/strict";
import { test } from "node:test";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult } from "effect/reactivity";
import { TestClock } from "effect/testing";
import { polled, polledOrFailed } from "./polled.ts";

test("a failed answer asks again on the schedule instead of ending the stream, and a defect still ends it", async () => {
  let calls = 0;
  const flaky = Effect.suspend(() => {
    calls += 1;
    return calls === 2 ? Effect.fail("busy") : Effect.succeed(calls);
  });
  const values = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Stream.runCollect(Stream.take(polled(flaky, "30 seconds"), 3)).pipe(Effect.forkChild);
      for (let tick = 0; tick < 4; tick += 1) yield* TestClock.adjust("30 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.deepEqual([...values], [1, 3, 4]);

  const dead = await Effect.runPromiseExit(Stream.runCollect(polled(Effect.die("unknown method"), "30 seconds")));
  assert.ok(Exit.isFailure(dead));
});

test("asks sooner while the last answer says something is under way, and at the usual pace after", async () => {
  const times = await Effect.runPromise(
    Effect.gen(function* () {
      let asked = 0;
      const ask = Effect.gen(function* () {
        asked += 1;
        return { at: yield* Clock.currentTimeMillis, running: asked < 3 };
      });
      const fiber = yield* polled(ask, "30 seconds", { every: "3 seconds", when: (last) => last.running }).pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
      yield* TestClock.adjust("2 minutes");
      return (yield* Fiber.join(fiber)).map(({ at }) => at);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.deepEqual(times, [0, 3_000, 6_000, 36_000]);
});

test("a failure shows beside the last answer, and the asking goes on until an answer clears it", async () => {
  let calls = 0;
  const flaky = Effect.suspend(() => {
    calls += 1;
    return calls === 2 || calls === 3 ? Effect.fail("unreadable") : Effect.succeed(calls);
  });
  const results = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Stream.runCollect(Stream.take(polledOrFailed(flaky, "60 seconds"), 4)).pipe(Effect.forkChild);
      yield* TestClock.adjust("5 minutes");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.deepEqual(
    results.map((result) => [result._tag, Option.getOrNull(AsyncResult.value(result))]),
    [
      ["Success", 1],
      ["Failure", 1],
      ["Failure", 1],
      ["Success", 4],
    ],
  );
});
