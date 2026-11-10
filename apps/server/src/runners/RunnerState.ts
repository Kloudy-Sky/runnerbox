import type { InstallState } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { readSlotStates } from "runnerbox/src/launcher/slot-state.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { LogReadError } from "../history/StateLogs.ts";

// `up` rewrites its file at least every 15 seconds while it runs, so older than this means it
// stopped without saying so.
const STALE_MS = 45_000;
// The file changes when a slot does, which is seconds apart at most, and reading it is cheap.
const POLL = Schedule.spaced("2 seconds");

// Each install's live state, from the file `up` keeps beside its logs.
export class RunnerState extends Context.Service<
  RunnerState,
  {
    readonly current: Effect.Effect<ReadonlyArray<InstallState>, LogReadError>;
    readonly changes: Stream.Stream<ReadonlyArray<InstallState>, LogReadError>;
  }
>()("runnerbox/server/RunnerState") {}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerPaths.ServerPaths;
  const current = Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => readSlotStates(stateDir),
      catch: (cause) => new LogReadError({ what: "runner state", cause }),
    });
    const now = yield* Clock.currentTimeMillis;
    return files.map(({ v: _v, ...file }) => ({ ...file, stale: now - Date.parse(file.updatedAt) > STALE_MS }));
  }).pipe(Effect.withSpan("RunnerState.current"));
  // Every subscriber polls on its own; there are a few clients at most.
  const changes = Stream.fromEffectSchedule(current, POLL).pipe(Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)));
  return RunnerState.of({ current, changes });
});

export const layer = Layer.effect(RunnerState, make);
