import { type InboxItem, type InboxItemState, Instant } from "@runnerbox/contracts";
import * as Schema from "effect/Schema";

// Snooze and settle for inbox items, written after T3 Code's thread settle and snooze: the wake
// rules in packages/client-runtime/src/state/threadSettled.ts and the thread.settle,
// thread.unsettle, thread.snooze and thread.unsnooze handling in
// apps/server/src/orchestration-v2/Orchestrator.ts. An item stands in for a thread, and its
// newest failure for the thread's failed run.

// The owner's choices for one item, as the server stores them, named as T3 Code's thread fields
// are. `seenAt` is when the inbox last showed the item, so state for one gone for good is dropped.
export const StoredItemState = Schema.Struct({
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])),
  settledAt: Schema.NullOr(Instant),
  unsettledAt: Schema.NullOr(Instant),
  snoozedUntil: Schema.NullOr(Instant),
  snoozedAt: Schema.NullOr(Instant),
  seenAt: Instant,
});
export type StoredItemState = typeof StoredItemState.Type;

export const blankState = (now: string): StoredItemState => ({
  settledOverride: null,
  settledAt: null,
  unsettledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  seenAt: now,
});
// Nothing left to remember, so the entry can go.
export const isBlank = (stored: StoredItemState) => stored.settledOverride === null && stored.snoozedUntil === null;

// Settling ends any snooze. Each choice is dated now, since a failure after that date undoes it.
export const settle = (stored: StoredItemState, now: string): StoredItemState => ({
  ...stored,
  settledOverride: "settled",
  settledAt: now,
  unsettledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
});
export const unsettle = (stored: StoredItemState, now: string): StoredItemState => ({ ...stored, settledOverride: "active", settledAt: null, unsettledAt: now });
// Re-snoozing acknowledges the latest wake, as in T3 Code.
export const snooze = (stored: StoredItemState, until: string, now: string): StoredItemState => ({ ...stored, snoozedUntil: until, snoozedAt: now });
export const wake = (stored: StoredItemState): StoredItemState => ({ ...stored, snoozedUntil: null, snoozedAt: null });

// When the latest of these attempts ended, or `fallback` when none says.
const latestEnd = (attempts: InboxItem["evidence"]["attempts"], fallback: string) => {
  const ends = attempts.flatMap((attempt) => (attempt.startedAt === null ? [] : [Date.parse(attempt.startedAt) + (attempt.durationMs ?? 0)])).filter((ms) => !Number.isNaN(ms));
  return ends.length === 0 ? fallback : new Date(Math.max(...ends)).toISOString();
};

// When the newest failure behind an item ended, or null for an item that isn't a failure, like a
// slow job. A passing run never moves it, which is why a passing run never wakes a snooze.
export function failedAt(item: InboxItem): string | null {
  switch (item.kind) {
    case "failure":
      // Failed as `isFailure` in jobs.ts reads it.
      return latestEnd(
        item.evidence.attempts.filter((attempt) => attempt.conclusion === "failure" || attempt.conclusion === "timed_out"),
        item.at,
      );
    case "no_runner":
      // A wait fails when it ends without a runner, not when the job was queued (`item.at`).
      return latestEnd(item.evidence.attempts, item.at);
    case "failing_slot":
      return item.at;
    case "slow_job":
      return null;
  }
}

const failedSince = (item: InboxItem, since: string | null) => {
  const at = failedAt(item);
  return at !== null && (since === null || Date.parse(at) > Date.parse(since));
};

// What the owner sees for an item now. A later run that passed settles it on its own, as T3 Code
// auto-settles, unless the owner unsettled it. A failure after the owner's choice undoes it, as a
// new message clears a thread's override. Only a fresh failure ends a snooze early.
export function itemState(stored: StoredItemState | undefined, item: InboxItem, now: number): InboxItemState {
  const override =
    stored?.settledOverride != null && !failedSince(item, stored.settledOverride === "settled" ? stored.settledAt : stored.unsettledAt)
      ? stored.settledOverride
      : null;
  if (override === "settled" || (override === null && item.quiet === "resolved")) {
    return { status: "settled", snoozedUntil: null, wokeAt: null, settledAt: override === "settled" ? (stored?.settledAt ?? null) : null };
  }
  const active: InboxItemState = { status: "active", snoozedUntil: null, wokeAt: null, settledAt: null };
  if (!stored?.snoozedUntil) return active;
  if (failedSince(item, stored.snoozedAt)) return { ...active, status: "back", wokeAt: failedAt(item) };
  return Date.parse(stored.snoozedUntil) > now
    ? { ...active, status: "snoozed", snoozedUntil: stored.snoozedUntil }
    : { ...active, status: "back", wokeAt: stored.snoozedUntil };
}
