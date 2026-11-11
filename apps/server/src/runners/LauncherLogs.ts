import type { LauncherEvent, MachineSample } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { InstallSample } from "runnerbox/src/tracking/sample-log.ts";
import * as StateLogs from "../history/StateLogs.ts";

const DAY_MS = 24 * 60 * 60_000;

// Keeps at most `maxPoints` samples per install. Each stretch keeps the sample with the least VM
// memory available, or host memory without a VM reading, so thinning never hides a low point.
export function thinSamples(samples: readonly InstallSample[], maxPoints: number): MachineSample[] {
  const lowest = (a: InstallSample, b: InstallSample) => {
    const level = ({ sample }: InstallSample) => sample.vm?.availableMiB ?? sample.host?.availableMiB ?? Infinity;
    return level(b) < level(a) ? b : a;
  };
  return [...Map.groupBy(samples, ({ install }) => install).values()].flatMap((own) => {
    const stride = Math.ceil(own.length / maxPoints);
    const kept: InstallSample[] = [];
    for (let index = 0; index < own.length; index += stride) kept.push(own.slice(index, index + stride).reduce(lowest));
    return kept.map(({ install, sample }) => ({ install, ...sample }));
  });
}

// What `up` recorded about its own work and the machines it ran on.
export class LauncherLogs extends Context.Service<
  LauncherLogs,
  {
    readonly events: (days: number) => Effect.Effect<ReadonlyArray<LauncherEvent>, StateLogs.LogReadError>;
    readonly samples: (days: number, maxPoints: number) => Effect.Effect<ReadonlyArray<MachineSample>, StateLogs.LogReadError>;
  }
>()("runnerbox/server/LauncherLogs") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const since = (days: number) => Clock.currentTimeMillis.pipe(Effect.map((now) => now - days * DAY_MS));
  return LauncherLogs.of({
    events: Effect.fn("LauncherLogs.events")(function* (days: number) {
      return yield* logs.events(yield* since(days));
    }),
    samples: Effect.fn("LauncherLogs.samples")(function* (days: number, maxPoints: number) {
      return thinSamples(yield* logs.samples(yield* since(days)), maxPoints);
    }),
  });
});

export const layer = Layer.effect(LauncherLogs, make);
