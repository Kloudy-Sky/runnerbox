import type { Inbox as InboxView } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { machineLookup } from "../history/machineLookup.ts";
import * as StateLogs from "../history/StateLogs.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { buildInbox } from "./derive.ts";
import { DAY_MS } from "./jobs.ts";

// What CI needs from the runner owner, across every repo with a job log, with a headline for the
// home screen. See rules.ts for the judgement and derive.ts for how it's put together.
export class Inbox extends Context.Service<
  Inbox,
  { readonly list: (days: number) => Effect.Effect<InboxView, StateLogs.LogReadError> }
>()("runnerbox/server/Inbox") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const runners = yield* RunnerState.RunnerState;
  const list = Effect.fn("Inbox.list")(function* (days: number) {
    const now = yield* Clock.currentTimeMillis;
    const since = now - days * DAY_MS;
    return buildInbox(
      {
        now,
        jobs: yield* logs.allJobs(since),
        machine: machineLookup(yield* logs.samples(since)),
        events: yield* logs.events(since),
        installs: yield* runners.current,
      },
      days,
    );
  });
  return Inbox.of({ list });
});

export const layer = Layer.effect(Inbox, make);
