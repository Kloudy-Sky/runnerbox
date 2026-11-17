import type { InboxItem, Inbox as InboxView } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { machineLookup } from "../history/machineLookup.ts";
import * as StateLogs from "../history/StateLogs.ts";
import { Proposals } from "../proposals/Proposals.ts";
import * as Reviews from "../reviews/Reviews.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { buildInbox, deriveInbox } from "./derive.ts";
import { withFixes } from "./fixes.ts";
import * as InboxState from "./InboxState.ts";
import { DAY_MS } from "./jobs.ts";
import { isMachineFailure } from "./memoryTrouble.ts";
import type { InboxInput } from "./rules.ts";

// What CI needs from the runner owner, across every repo with a job log, with a headline for the
// home screen, each item's snooze or settle, and the fix a rule proposed for it. See rules.ts for
// the judgement, derive.ts for how it's put together, InboxState.ts for the owner's choices and
// RuleFixes.ts for the fixes. Open pull requests come from the reviews' list, so a failing check
// can say how many it blocks.
export class Inbox extends Context.Service<
  Inbox,
  {
    readonly list: (days: number) => Effect.Effect<InboxView, StateLogs.LogReadError>;
    // The items with their snooze and settle, and what they were derived from, for the server's
    // own rules.
    readonly derived: (days: number) => Effect.Effect<{ readonly input: InboxInput; readonly items: InboxItem[] }, StateLogs.LogReadError>;
  }
>()("runnerbox/server/Inbox") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const runners = yield* RunnerState.RunnerState;
  const state = yield* InboxState.InboxState;
  const reviews = yield* Reviews.Reviews;
  const proposals = yield* Proposals;
  // Without the sign-in, or when GitHub's answer was partial, nothing is counted rather than counted short.
  const openPulls = reviews.heads.pipe(
    Effect.map((heads) => heads ?? undefined),
    Effect.orElseSucceed(() => undefined),
  );

  const derived = Effect.fn("Inbox.derived")(function* (days: number) {
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
    return { input, items: yield* state.attach(deriveInbox(input)) };
  });

  const list = Effect.fn("Inbox.list")(function* (days: number) {
    const { input, items } = yield* derived(days);
    // Proposals are read only when an item could have a rule's fix.
    const open = items.some(isMachineFailure)
      ? yield* proposals.list.pipe(Effect.catch((error) => Effect.logWarning(`inbox: listed without fixes: ${error.why}`).pipe(Effect.as([]))))
      : [];
    return buildInbox(input, days, withFixes(items, open));
  });

  return Inbox.of({ list, derived });
});

export const layer = Layer.effect(Inbox, make);
