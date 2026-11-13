import { join } from "node:path";
import {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_MONITOR_MODEL,
  type InboxItem,
  MonitorError,
  MonitorRun,
  MonitorSettings,
  type MonitorStatus,
  type ThreadError,
  type ThreadSubject,
} from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as Inbox from "../inbox/Inbox.ts";
import * as Threads from "../threads/Threads.ts";

// A monitor: when something new needs the owner, the agent looks into it on its own and leaves what
// it found in that item's thread. Off by default. It only reads, runs one look at a time, and
// stops at the owner's daily limit, skipping (never queueing) what comes after it. The owner's
// own threads are never counted or held back.

export const CHECK_EVERY = Duration.minutes(15);
// An item seen within this long isn't new again, so one that comes back the next day isn't looked
// into twice.
const SEEN_FOR_MS = 14 * 24 * 60 * 60_000;
const MAX_RUNS_KEPT = 20;
export const QUESTION = "This just appeared in the inbox. Look into it and say what you found.";

const Day = Schema.Struct({ date: Schema.String, looks: Schema.Int, costUsd: Schema.Number, skipped: Schema.Int });
const State = Schema.Struct({
  v: Schema.Literal(1),
  settings: MonitorSettings,
  seen: Schema.Record(Schema.String, Schema.String),
  day: Day,
  runs: Schema.Array(MonitorRun),
  unread: Schema.Array(Schema.String),
});
type State = typeof State.Type;
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(State));

// The server's own day, so the limit resets at its midnight.
const localDate = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const fresh = (ms: number): State => ({
  v: 1,
  settings: { enabled: false, dailyLimit: DEFAULT_DAILY_LIMIT, accountId: null, model: null },
  seen: {},
  day: { date: localDate(ms), looks: 0, costUsd: 0, skipped: 0 },
  runs: [],
  unread: [],
});
// Today's counts, from zero once the date has moved on.
const today = (state: State, ms: number): State => (state.day.date === localDate(ms) ? state : { ...state, day: { date: localDate(ms), looks: 0, costUsd: 0, skipped: 0 } });

export class Monitors extends Context.Service<
  Monitors,
  {
    readonly status: (canConfigure: boolean) => Effect.Effect<MonitorStatus, MonitorError>;
    // Turning it on marks what's in the inbox now as seen, so it never spends on a backlog;
    // turning it off stops a look in progress.
    readonly save: (settings: MonitorSettings) => Effect.Effect<MonitorStatus, MonitorError>;
    readonly markRead: (itemId: string) => Effect.Effect<void, MonitorError>;
    // One pass over the inbox, which runs every 15 minutes while monitors are on.
    readonly check: Effect.Effect<void>;
  }
>()("runnerbox/server/monitors/Monitors") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const threads = yield* Threads.Threads;
  const inbox = yield* Inbox.Inbox;
  const path = join(serverDir, "monitor.json");
  const unreadable = () => new MonitorError({ why: "Couldn't read or write the monitor's settings on the server." });
  // Guards the file; `checking` keeps looks one at a time across passes.
  const lock = yield* Semaphore.make(1);
  const checking = yield* Semaphore.make(1);
  // The thread a look is running in, so turning monitors off can stop it.
  let active: string | null = null;

  const read = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const text = yield* fs.readFileString(path).pipe(
      Effect.map(Option.some),
      Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(Option.none<string>()) : Effect.fail(error))),
    );
    return Option.isSome(text) ? today(yield* decodeState(text.value), now) : fresh(now);
  }).pipe(Effect.mapError(unreadable));
  const write = (state: State) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(state, null, 2)}\n`)), Effect.mapError(unreadable));
  const update = <A>(change: (state: State) => readonly [State, A]) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const [next, result] = change(yield* read);
        yield* write(next);
        return result;
      }),
    );

  const needsYou = inbox.list(14).pipe(
    Effect.map((view) => view.items),
    Effect.mapError(() => new MonitorError({ why: "Couldn't read the inbox." })),
  );

  const status = (canConfigure: boolean) =>
    read.pipe(
      Effect.map((state) => ({
        settings: state.settings,
        today: { looks: state.day.looks, costUsd: state.day.costUsd, skipped: state.day.skipped },
        runs: state.runs,
        unread: state.unread,
        canConfigure,
      })),
    );

  const save = Effect.fn("Monitors.save")(function* (settings: MonitorSettings) {
    const before = (yield* read).settings;
    const now = yield* Clock.currentTimeMillis;
    // Everything in the inbox when it's turned on was there before the owner asked for this.
    const backlog = settings.enabled && !before.enabled ? yield* needsYou : [];
    yield* update((state) => [{ ...state, settings, seen: { ...state.seen, ...Object.fromEntries(backlog.map((item) => [item.id, new Date(now).toISOString()])) } }, undefined]);
    if (!settings.enabled && active !== null) yield* threads.interrupt(active).pipe(Effect.ignore);
    return yield* status(true);
  });

  const markRead = (itemId: string) => update((state) => [{ ...state, unread: state.unread.filter((id) => id !== itemId) }, undefined]);

  // One look: the item's latest thread, or a new one, and a monitor turn in it.
  const look = Effect.fn("Monitors.look")(function* (item: InboxItem, settings: MonitorSettings) {
    const subject: ThreadSubject = { _tag: "inbox", itemId: item.id };
    const thread = (yield* threads.list(subject))[0] ?? (yield* threads.create(subject, 14));
    const { turnId } = yield* threads.startTurn(thread.id, QUESTION, { accountId: settings.accountId ?? undefined, scopes: [], monitor: { model: settings.model ?? DEFAULT_MONITOR_MODEL } });
    return { threadId: thread.id, turnId };
  });

  // Why a look couldn't start, in the words Settings shows beside it.
  const refusal = (error: ThreadError) => {
    switch (error.reason) {
      case "account_not_found":
        return "the account picked here doesn't exist any more";
      case "provider_unavailable":
        return "no agent could run on this machine";
      default:
        return error.message;
    }
  };

  const ended = (threadId: string, turnId: string) =>
    threads.subscribe(threadId).pipe(
      Stream.flatMap((event) => (event._tag === "Snapshot" ? Stream.fromIterable(event.detail.items) : Stream.make(event))),
      Stream.filter((event) => event._tag === "TurnEnded" && event.turnId === turnId),
      Stream.runHead,
      Effect.map((found) => (Option.isSome(found) && found.value._tag === "TurnEnded" ? found.value : null)),
    );

  const record = (run: MonitorRun, costUsd: number) =>
    update((state) => [
      {
        ...state,
        runs: [run, ...state.runs.filter((each) => !(each.threadId === run.threadId && each.startedAt === run.startedAt))].slice(0, MAX_RUNS_KEPT),
        day: { ...state.day, costUsd: state.day.costUsd + costUsd },
        // A look that never started left nothing in the thread to read.
        unread: run.outcome === "running" || run.why !== undefined || state.unread.includes(run.itemId) ? state.unread : [...state.unread, run.itemId],
      },
      undefined,
    ]);

  const check = checking.withPermits(1)(
    Effect.gen(function* () {
      if (!(yield* read).settings.enabled) return;
      const items = yield* needsYou;
      const now = yield* Clock.currentTimeMillis;
      const arrived = yield* update((state) => {
        const kept = Object.fromEntries(Object.entries(state.seen).filter(([, at]) => now - Date.parse(at) < SEEN_FOR_MS));
        const added = items.filter((item) => !(item.id in kept));
        // Every item still there is seen again now, so 14 days count from when it was last there.
        return [{ ...state, seen: { ...kept, ...Object.fromEntries(items.map((item) => [item.id, new Date(now).toISOString()])) } }, added] as const;
      });
      for (const item of arrived) {
        const { settings, day } = yield* read;
        if (!settings.enabled) return;
        // At the limit, an item is skipped, not saved for tomorrow.
        if (day.looks >= settings.dailyLimit) {
          yield* update((state) => [{ ...state, day: { ...state.day, skipped: state.day.skipped + 1 } }, undefined]);
          continue;
        }
        const startedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
        const started = yield* look(item, settings).pipe(
          Effect.map((ids) => ({ _tag: "Started", ...ids }) as const),
          Effect.catchTag("ThreadError", (error) => Effect.succeed({ _tag: "Refused", error } as const)),
        );
        if (started._tag === "Refused") {
          // The owner already has a turn running in that thread; it isn't a look and isn't counted.
          if (started.error.reason === "turn_running") continue;
          // Anything else is shown, so a removed account or a signed-out agent doesn't look like a quiet inbox.
          const why = refusal(started.error);
          yield* Effect.logWarning(`monitor: couldn't look into ${item.id}: ${why}`);
          yield* record({ itemId: item.id, title: item.title, threadId: "", startedAt, outcome: "failed", costUsd: null, why }, 0);
          continue;
        }
        const { threadId, turnId } = started;
        // Set before anything else, so turning monitors off from here on stops this turn.
        active = threadId;
        const run: MonitorRun = { itemId: item.id, title: item.title, threadId, startedAt, outcome: "running", costUsd: null };
        yield* Effect.gen(function* () {
          // Turned off while the turn was starting, before `active` was set.
          if (!(yield* read).settings.enabled) yield* threads.interrupt(threadId).pipe(Effect.ignore);
          yield* update((state) => [{ ...state, day: { ...state.day, looks: state.day.looks + 1 } }, undefined]);
          yield* record(run, 0);
          const end = yield* ended(threadId, turnId);
          yield* record({ ...run, outcome: end?.outcome ?? "interrupted", costUsd: end?.costUsd ?? null }, end?.costUsd ?? 0);
        }).pipe(Effect.ensuring(Effect.sync(() => (active = null))));
      }
    }).pipe(Effect.catch((error) => Effect.logWarning(`monitor: ${error.message}`))),
  );

  yield* Effect.forkScoped(check.pipe(Effect.repeat(Schedule.spaced(CHECK_EVERY))));
  return Monitors.of({ status, save, markRead, check });
});

export const layer = Layer.effect(Monitors, make);
