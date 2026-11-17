import { type InboxItem, isInboxItemHidden, type Proposal } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import { Proposals } from "../proposals/Proposals.ts";
import { runUrl } from "../proposals/runUrl.ts";
import * as Inbox from "./Inbox.ts";
import { DAY_MS } from "./jobs.ts";
import { isMachineFailure, type MemoryTrouble, memoryTrouble } from "./memoryTrouble.ts";
import type { InboxInput } from "./rules.ts";

// Fixes a rule can write without the agent, because the fix is always the same. Only one so far:
// a kind that ran out of memory runs one fewer runner at once. The rule records a proposal like
// the agent's, and nothing changes until the owner approves it. The server runs it on its own
// schedule, so reading the inbox never writes one.

// A decision holds the next proposal for that item back this long: after a decline, so the owner
// isn't asked again on every pass; after a change applied, so it has time to show.
export const HOLD_BACK_MS = 7 * DAY_MS;
// A proposal stays open for 24 hours and none of these fixes is urgent, so the pace monitors look
// at is soon enough, and a pass costs only a few file reads.
export const CHECK_EVERY = Duration.minutes(15);
// The window monitors and the app's inbox read.
const DAYS = 14;

export class RuleFixes extends Context.Service<
  RuleFixes,
  {
    // One pass over the inbox: proposes where a rule knows the fix and nothing holds it back. It
    // runs every 15 minutes, never on a request, and never fails.
    readonly check: Effect.Effect<void>;
  }
>()("runnerbox/server/inbox/RuleFixes") {}

// One rule proposal per item at a time: an open, approved or waiting one holds the next back, and
// so does one that ended within the hold-back. One the owner let expire counts as declined, so
// ignoring it doesn't bring it back the next day.
const holdsBack = (proposal: Proposal, now: number) => {
  if (proposal.status === "open" || proposal.status === "approved" || proposal.status === "waiting") return true;
  const endedAt = proposal.decidedAt ?? (proposal.status === "expired" ? proposal.expiresAt : null);
  return endedAt !== null && now - Date.parse(endedAt) < HOLD_BACK_MS;
};

const make = Effect.gen(function* () {
  const inbox = yield* Inbox.Inbox;
  const proposals = yield* Proposals;
  // Passes run one at a time, so two can't both find no proposal and both write one.
  const lock = yield* Semaphore.make(1);

  const proposeFewer = Effect.fn("RuleFixes.proposeFewer")(function* (item: InboxItem, trouble: MemoryTrouble) {
    const path = `runners.${trouble.kind}.slots`;
    const slots = (yield* proposals.settings(trouble.install)).fields.find((field) => field.path === path)?.value;
    if (typeof slots !== "number" || slots <= 1) return;
    const times = trouble.failures === 1 ? "once" : `${trouble.failures} times`;
    yield* proposals.propose({
      threadId: null,
      rule: { itemId: item.id },
      install: trouble.install,
      changes: [{ path, to: slots - 1 }],
      reason: `The ${trouble.job} check failed ${times} when ${trouble.install} ran out of memory running up to ${slots} jobs at once. Running ${slots - 1} at a time leaves it room.`,
      runUrl: runUrl(trouble.last.repo, trouble.last.runId),
    });
  });

  const proposeFor = (item: InboxItem, input: InboxInput, all: ReadonlyArray<Proposal>, now: number) => {
    const mine = all.filter((proposal) => proposal.rule?.itemId === item.id);
    if (mine.some((proposal) => holdsBack(proposal, now))) return Effect.void;
    // Failures from before an applied change ran with the old number, so they don't count again.
    const since = Math.max(0, ...mine.filter((proposal) => proposal.status === "applied").map((proposal) => Date.parse(proposal.decidedAt ?? "")).filter(Number.isFinite));
    const trouble = memoryTrouble(item, input, since);
    if (!trouble) return Effect.void;
    // `up`'s live state has one entry per slot. When it shows one, there's nothing to take away,
    // and asking `up` would measure the machine for nothing on every pass.
    const live = input.installs.find((install) => install.install === trouble.install)?.kinds.find((kind) => kind.name === trouble.kind)?.slots.length;
    if (live !== undefined && live <= 1) return Effect.void;
    return proposeFewer(item, trouble).pipe(Effect.catch((error) => Effect.logDebug(`inbox: no fix for ${item.id}: ${error.why}`)));
  };

  const check = lock.withPermits(1)(
    Effect.gen(function* () {
      const { input, items } = yield* inbox.derived(DAYS);
      const candidates = items.filter((item) => !isInboxItemHidden(item) && isMachineFailure(item));
      if (candidates.length === 0) return;
      const all = yield* proposals.list;
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.forEach(candidates, (item) => proposeFor(item, input, all, now), { discard: true });
    }).pipe(Effect.catch((error) => Effect.logWarning(`inbox: no rule fixes this pass: ${error.message}`))),
  );

  yield* Effect.forkScoped(check.pipe(Effect.repeat(Schedule.spaced(CHECK_EVERY))));
  return RuleFixes.of({ check });
});

export const layer = Layer.effect(RuleFixes, make);
