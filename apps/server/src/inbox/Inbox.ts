import type { Inbox as InboxView } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { machineLookup } from "../history/machineLookup.ts";
import * as StateLogs from "../history/StateLogs.ts";
import * as Reviews from "../reviews/Reviews.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { buildInbox, deriveInbox } from "./derive.ts";
import * as InboxState from "./InboxState.ts";
import { DAY_MS } from "./jobs.ts";

// What CI needs from the runner owner, across every repo with a job log, with a headline for the
// home screen, and each item's snooze or settle. See rules.ts for the judgement, derive.ts for how
// it's put together and InboxState.ts for the owner's choices. Open pull requests come from the
// reviews' list, so a failing check can say how many it blocks.
export class Inbox extends Context.Service<
  Inbox,
  { readonly list: (days: number) => Effect.Effect<InboxView, StateLogs.LogReadError> }
>()("runnerbox/server/Inbox") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const runners = yield* RunnerState.RunnerState;
  const state = yield* InboxState.InboxState;
  const reviews = yield* Reviews.Reviews;
  // Without the sign-in, or when GitHub's answer was partial, nothing is counted rather than counted short.
  const openPulls = reviews.heads.pipe(
    Effect.map((heads) => heads ?? undefined),
    Effect.orElseSucceed(() => undefined),
  );
  const list = Effect.fn("Inbox.list")(function* (days: number) {
    const now = yield* Clock.currentTimeMillis;
    const since = now - days * DAY_MS;
    const input = {
      now,
      jobs: yield* logs.allJobs(since),
      machine: machineLookup(yield* logs.samples(since)),
      events: yield* logs.events(since),
      installs: yield* runners.current,
      openPulls: yield* openPulls,
    };
    return buildInbox(input, days, yield* state.attach(deriveInbox(input)));
  });
  return Inbox.of({ list });
});

export const layer = Layer.effect(Inbox, make);
