import type { RunnersExplained as Explained } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as StateLogs from "../history/StateLogs.ts";
import { explainInstall } from "./explain/explain.ts";
import { HOUR_MS } from "./explain/lanes.ts";
import * as RunnerState from "./RunnerState.ts";

const DAY_MS = 24 * HOUR_MS;
// The memory picture needs only the last few minutes of samples.
const SAMPLES_MS = 5 * 60_000;

// Each install's runners in plain words: what they're doing now and what happened in the last
// `days`, written by rules over the machine's records.
export class RunnersExplained extends Context.Service<
  RunnersExplained,
  { readonly explain: (days: number) => Effect.Effect<Explained, StateLogs.LogReadError> }
>()("runnerbox/server/RunnersExplained") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const runners = yield* RunnerState.RunnerState;
  const explain = Effect.fn("RunnersExplained.explain")(function* (days: number) {
    const now = yield* Clock.currentTimeMillis;
    // The lanes always cover the last hour, whatever the window.
    const since = now - Math.max(days * DAY_MS, HOUR_MS);
    const [installs, events, jobs, samples, containerSamples] = yield* Effect.all([
      runners.current,
      logs.events(since),
      logs.allJobs(since),
      logs.samples(now - SAMPLES_MS),
      logs.containerSamples(now - SAMPLES_MS),
    ]);
    const own = <T extends { install: string }>(rows: readonly T[], install: string) => rows.filter((row) => row.install === install);
    return {
      at: new Date(now).toISOString(),
      installs: installs.map((install) =>
        explainInstall({
          now,
          install,
          events: own(events, install.install),
          jobs,
          samples: own(samples, install.install),
          containerSamples: own(containerSamples, install.install),
        }),
      ),
    };
  });
  return RunnersExplained.of({ explain });
});

export const layer = Layer.effect(RunnersExplained, make);
