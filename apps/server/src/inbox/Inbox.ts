import type { InboxItem } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { machineLookup } from "../history/machineLookup.ts";
import * as StateLogs from "../history/StateLogs.ts";
import { deriveInbox } from "./rules.ts";

const DAY_MS = 24 * 60 * 60_000;

// What CI needs from the runner owner, across every repo with a job log. See rules.ts.
export class Inbox extends Context.Service<
  Inbox,
  { readonly list: (days: number) => Effect.Effect<ReadonlyArray<InboxItem>, StateLogs.LogReadError> }
>()("runnerbox/server/Inbox") {}

const make = Effect.gen(function* () {
  const logs = yield* StateLogs.StateLogs;
  const list = Effect.fn("Inbox.list")(function* (days: number) {
    const now = yield* Clock.currentTimeMillis;
    const since = now - days * DAY_MS;
    return deriveInbox({
      now,
      jobs: yield* logs.allJobs(since),
      machine: machineLookup(yield* logs.samples(since)),
      events: yield* logs.events(since),
      installs: [],
    });
  });
  return Inbox.of({ list });
});

export const layer = Layer.effect(Inbox, make);
